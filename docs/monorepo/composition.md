# Cross-package composition

Once you have more than one package in a monorepo, you typically have one or more apps that compose manifests from shared libraries. This is what app mode is for.

## The model

Each package generates its own manifest in library mode, scanning only its own source. The app's config declares which packages it composes with via `composedManifests`. Codegen produces an extra file in the app — `ioc-composed.ts` — that imports each package's manifest, intersects their cradle types, and emits compile-time assertions that every composed package's externals are satisfied.

At runtime, the app passes the composed manifests array to `registerIocFromManifest`. Composition is set-like: ordering doesn't matter. Conflicts (two manifests supplying the same registration key) are hard errors by default, resolved via explicit `source` config.

## A monorepo example

```
packages/
  lib-storage/        # library mode
    src/
      ioc.config.ts
      factories/
      types/
  lib-services/       # library mode
    src/
      ioc.config.ts
      factories/
      types/
  app/                # app mode
    src/
      ioc.config.ts
      bootstrap.ts
      factories/
```

`lib-storage` registers `Storage` implementations. `lib-services` registers services that consume `Storage` (declared in their deps types — so `storage` appears in `lib-services`'s `IocExternals`). The app composes both and supplies anything neither library supplies.

## App config

```ts
// packages/app/src/ioc.config.ts
import { defineIocConfig } from "ioc-manifest";

export default defineIocConfig({
  discovery: {
    scanDirs: "src",
    generatedDir: "generated",
  },
  composedManifests: ["@example/lib-storage", "@example/lib-services"],
  registrations: {
    Storage: {
      s3Storage: { default: true },
    },
  },
});
```

## Required package exports

Each composed package's `package.json` must expose two subpath exports:

```jsonc
{
  "exports": {
    ".": "./src/index.ts",
    "./iocManifest": "./src/generated/ioc-manifest.js",
    "./iocTypes": "./src/generated/ioc-registry.types.js",
  },
}
```

(Substitute `./dist/...` for published packages with a build step.)

## Generated `ioc-composed.ts`

```ts
/* AUTO-GENERATED. DO NOT EDIT. */
import { iocManifest as localManifest } from "./ioc-manifest.js";
import { iocManifest as libStorageManifest } from "@example/lib-storage/iocManifest";
import { iocManifest as libServicesManifest } from "@example/lib-services/iocManifest";

import type { IocGeneratedCradle as LocalCradle } from "./ioc-registry.types.js";
import type { IocGeneratedCradle as LibStorageCradle } from "@example/lib-storage/iocTypes";
import type { IocGeneratedCradle as LibServicesCradle } from "@example/lib-services/iocTypes";
import type { IocExternals as LibStorageExternals } from "@example/lib-storage/iocTypes";
import type { IocExternals as LibServicesExternals } from "@example/lib-services/iocTypes";

export const composedManifests = [
  localManifest,
  libStorageManifest,
  libServicesManifest,
] as const;

export type AppCradle = LocalCradle & LibStorageCradle & LibServicesCradle;

// Compile-time externals satisfaction assertions
type _IocExpect<T extends true> = T;
type _LibStorageExternalsSatisfied =
  LibStorageExternals extends Pick<AppCradle, keyof LibStorageExternals>
    ? true
    : false;
type _LibStorageExternalsAssert = _IocExpect<_LibStorageExternalsSatisfied>;
type _LibServicesExternalsSatisfied =
  LibServicesExternals extends Pick<AppCradle, keyof LibServicesExternals>
    ? true
    : false;
type _LibServicesExternalsAssert = _IocExpect<_LibServicesExternalsSatisfied>;

export const composedRegistrationOverrides = {
  /* ... */
};
```

If `lib-services` requires a `logger` and no manifest in the composition supplies it, `_LibServicesExternalsAssert` fails compilation with a TypeScript error pointing at the assertion line. You don't have to run anything to find out you forgot something.

## App bootstrap

```ts
import { createContainer } from "awilix";
import { registerIocFromManifest } from "ioc-manifest";
import {
  composedManifests,
  composedRegistrationOverrides,
  type AppCradle,
} from "./generated/ioc-composed.js";

const container = createContainer<AppCradle>();
registerIocFromManifest(
  container,
  composedManifests,
  composedRegistrationOverrides,
);

const uploadService = container.resolve("uploadService");
```

## Externals

An **external** is a key a package demands and does not register. It is a promise: this package will work once something supplies that key. Every package's generated `ioc-registry.types.ts` declares its externals in `IocExternals`, and the composing app's `generate` (and `ioc validate`) is where the promise is checked.

The supply side is each package's `IocGeneratedCradle` — every key it registers, including [contract slot keys](/concepts/conventions#contract-slot-keys). A demand for a contract key is therefore satisfied by whichever package elects a default for that contract, exactly as a demand for a registration key is satisfied by whichever package registers it.

Three verdicts are possible per key, and the `[externals]` category reports the last two:

- **Satisfied** — a composed cradle offers the key and its type is assignable to what the demanding package declared. Nothing is printed.
- **Unsatisfied** — either nothing offers the key, or something does and the types are incompatible. An error; the report prints the demanded type, the supplied type, and the first property that does not line up.
- **Unverified** — a supplier was found but the types could not be compared, usually because the checker could not resolve one of them. A warning that names the caveat rather than claiming a verdict it does not have.

A fourth outcome is **skipped**: if the generated registry-types file a comparison would read from does not compile, `[registry-integrity]` reports that and the comparisons depending on it are listed as skipped rather than adjudicated against error types (which pass unconditionally). The usual cause is generated output that predates a source change — regenerate the package the issue names.

**Library mode checks nothing here, and skips nothing either.** A library has no composed set to relate to; its `IocExternals` is a promise to whichever app composes it later, and that app's `generate` is the first run that can say whether the promise is kept.

## Resolving same-key conflicts

If two composed manifests both supply the same Awilix registration key, composition fails with a hard error naming both manifests. Resolve via the `source` field:

```ts
registrations: {
  AlbumRepository: {
    albumRepository: { source: "local" }, // or "@example/lib-services"
  },
}
```

`source: "local"` picks the app's own factory; a package name picks that package's registration. There's no last-write-wins or array-position semantics — you decide explicitly which manifest's registration wins.

## Groups across manifests

If multiple composed packages declare contributors to the same group (e.g. several packages register `DiscountStrategy` implementations and all declare a `discountStrategies` collection group), the group merges across manifests. `container.resolve("discountStrategies")` returns the union.

For this to work, all contributors must reference the same canonical base type — typically by importing it from a shared contracts package.

That canonical identity is the group's `baseTypeId`, and in v3 it is **package-relative**: `<packageName>/<path within that package>:<TypeName>`, resolved from the nearest enclosing `package.json`.

```ts
// v2 — an absolute path; two developers regenerating the same package got different bytes,
// and npm hoisting changed it.
baseTypeId: "/home/alice/work/monorepo/packages/contracts/src/types/Storage.ts:Storage";

// v3 — identical on every machine, every checkout, and in CI.
baseTypeId: "@acme/contracts/src/types/Storage.ts:Storage";
```

This removes the main reason mismatches used to happen: hoisting changed the absolute path, so it changed the id, so two contributors to one group stopped matching.

What survives is the genuinely different case — the same logical type reached through different package *layouts*, such as a workspace `src/Storage.ts` build alongside a published `dist/Storage.d.ts` one. There, the library reports the mismatch with the exact config block to paste:

```ts
// in the app's ioc.config.ts
groupBaseTypeAliases: {
  discountStrategies: [
    "@acme/contracts/src/types/DiscountStrategy.ts:DiscountStrategy",
    "@acme/contracts/dist/types/DiscountStrategy.d.ts:DiscountStrategy",
  ],
}
```

The library treats the listed identifiers as equivalent. This is an escape hatch, not a normal-path mechanism — narrower in v3 than it was, but not gone.

::: warning Upgrading from v2
`baseTypeId` values change in every generated manifest that declares a group. Regenerate every package, and update any existing `groupBaseTypeAliases` entries to the new form — the composition error prints the values to copy.
:::

---
