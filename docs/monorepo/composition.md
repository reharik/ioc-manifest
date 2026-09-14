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

## Scope-reachable externals

The three verdicts above all assume the key is something the ROOT container can be asked for. Not every external is. A shared package can own a factory whose dependencies only exist per-request — the canonical case being a scoped logger that demands a `logContext` nobody can register on the root container, because the value does not exist until a scope opens.

So before asking whether a key is supplied, composition asks **when the obligation comes due**, by finding every resolution path that reaches it:

- **Some path reaches it from a composition root.** An ordinary composition-level external, judged exactly as above.
- **Every path crosses a scope boundary.** A *scope-reachable external*: not a composition-level obligation at all. The obligation propagates outward to the [scope root](/concepts/scope-roots) variants that can actually reach it, and is settled there — by that variant's declared late-bound-value set. A variant that reaches it and carries it is satisfied and prints nothing.
- **No path reaches it, and some factory demanding it is root-resolvable.** Reported as an ordinary unsatisfied external, the same as before — the walk does not see enough of an app's resolutions to draw the opposite conclusion safely. The report names the demander that blocked the clearance. See [What reachability can see](#what-reachability-can-see).
- **No path reaches it, and every factory demanding it is scoped.** Cleared: no obligation, no diagnostic, and the key leaves the emitted assertion block entirely. This is the one shape where "nothing reaches it" is safe to act on, and [What reachability can see](#what-reachability-can-see) explains why.

Propagation is **per variant**, never per root contract. Variants of one contract declare different late-bound-value sets, so they have different resolution subtrees and reach different keys; asking every variant of a root for a value only one of them resolves would demand declarations nobody consumes.

**Mixed reachability is a hard error**, and the message is about the root path. If one path reaches the key from a root and another only through a scope, the root path is still unsatisfiable — a value bound at scope-open never enters the root cradle — so a declaration at the scope end does not launder it.

Classification is automatic: no config key, and nothing to declare in the package that owns the factory. It is computed from data the manifests already carry, so a package that has regenerated needs no edit for its consumers to benefit.

### The assertion moves with the obligation

Clearing a key from the `[externals]` report is only half the job. `ioc-composed.ts` emits a compile-time assertion per external key, and for a scope-reachable key the old one — "this key is in `AppCradle`" — can never be true, because a value bound at scope-open never enters the root cradle. Left alone it would fail `tsc` over the app's own generated output on a run `ioc generate` had just passed.

So the assertion **relocates** rather than vanishing. For each opener that reaches the key, the emitted file asserts that the opener's declared late-bound values carry it, with a type the demanding package accepts:

```ts
type _Infra_logContext_at_openAuthenticatedReadScope =
  Parameters<AppCradle["openAuthenticatedReadScope"]>[0] extends {
    logContext: infer T;
  }
    ? T extends InfraExternals["logContext"]
      ? true
      : { iocError: "the declared late-bound value is not assignable to the demanded type"; key: "logContext"; opener: "openAuthenticatedReadScope"; package: "@packages/infrastructure" }
    : { iocError: "this scope opener does not declare the key"; key: "logContext"; opener: "openAuthenticatedReadScope"; package: "@packages/infrastructure" };
```

This is a **new** check, not a restored one. `verifyScopeRoots` compares a declared late-bound value against the types of local demand sites, and has nothing to compare against for a demand inside a composed package — a manifest records demand *keys* and never demand *types*. Here both types are in scope, so a variant declaring `logContext: string` against a demanded `Record<string, unknown>` is caught for the first time.

The failure branches are object types rather than `false` so the diagnostic says which of the two ways of being wrong this is, and for which key, opener and package. A conditional that collapses to `false` produces `Type 'false' does not satisfy the constraint 'true'` for every cause, with nothing on the cited line but an `_IocExpect<…>` instantiation.

::: tip When classification is withheld
A walk is only as good as the demand data under it. If any composed manifest does not claim `dependencyKeysComplete` — some factory in it takes its dependencies as a plain `(deps: Deps)` parameter, a shape the keys cannot be read from — or if a scope-root variant's own demand set cannot be read, reachability is not a verdict and every external is judged as root-resolvable, exactly as it was before. Regenerate the packages the `[externals]` report names to get the sharper answer.
:::

## What reachability can see

Reachability is computed over **registered units**. The walk starts from the registrations in the app's own manifest and follows each unit's recorded `dependencyKeys` through the composed set.

It does not see your composition root. `bootstrap.ts` is not a discovery target, has no manifest row, and its `container.resolve("uploadService")` calls are recorded nowhere. **A library unit your bootstrap resolves directly is invisible to the walk** — and so is everything only that unit demands.

In the example app on this page, the app registers `config` and `consoleLogger`, and its bootstrap resolves `uploadService`, `storage`, `archiveStorage`, `loggers`, `writeServices` and `requestTracingLogger` straight from the container. Not one of those six is reachable from a registered unit, so as far as the walk is concerned none of them participates in the graph at all.

This is why a key nothing reaches is still reported as unsatisfied. "No recorded path reaches it" is a much weaker statement than "your app never resolves it", and treating the first as the second would trade a build error for a production one: `ioc validate` would pass while the first `container.resolve` threw `Could not resolve '…'`.

### The one case where nothing reaching it is enough

There is a single shape where the blind spot above cannot apply: **every factory demanding the key is scoped**.

A resolve the walk cannot see is a resolve against the **root** container — that is what a composition root has. And a root resolve cannot reach a scoped factory; it fails at runtime whatever the walk saw. So an unrecorded bootstrap resolve cannot be hiding a path to a key only scoped factories demand, and the unmodelled roots stop mattering for that key. It is cleared: no obligation, no diagnostic, and no emitted assertion.

The mixed case needs no separate rule. If *any* demanding factory is root-resolvable the general limit applies and the key is not cleared, whether or not a scoped factory demands it too.

The scoped-ness read here is the one the demanding package's **manifest records**, never one inferred from its sources — a composing app cannot see another package's base classes. That matters in one specific way: a package whose `ioc.config` declares no [`lifetimeMarkers`](/config/reference#lifetimemarkers) block generates `lifetime: "singleton"` rows even for classes extending a scope lifecycle marker, because without the block the marker is inert. Such a demander blocks the clearance, correctly — and the report says so in as many words, naming the package and the missing block, rather than leaving an unsatisfied external with no visible cause.

Two consequences worth holding on to:

- **Reachability only ever narrows an obligation onto something it can still check.** A scope-reachable key is not dismissed — it moves onto the openers that reach it, where a compile-time assertion still holds it. Nothing is cleared into thin air on the strength of the walk alone.
- **A key that genuinely is not a container obligation is declared, not inferred** — outside the scoped-only case above, where the inference is closed rather than merely plausible. That declaration belongs to the package that owns the factory: [`scopeProvided`](/config/reference#scopeprovided) removes the key from that package's `IocExternals` so no consumer is ever asked for it. A statement by the party that knows carries weight an inference drawn from a partial graph does not.

The same limit applies to every static check here — lifetime-inversion ranking, scope-root subtree walks, externals exclusion. A unit that reaches around the container (importing a built container and calling `.resolve()` rather than declaring a dependency) is invisible to all of them, and cannot be detected: aliasing, re-export, `globalThis` and dynamic `import()` each defeat any check that tried. Declare your dependencies and the analysis is accurate; reach around the container and it is blind, quietly.

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

## Lifetimes across the boundary

An app's generation reads each composed manifest as **supply**, and the [lifetime-inversion check](/concepts/lifetimes#lifetime-inversion-checks) ranks edges into a composed package on the same terms as local ones. The lifetime written in a composed manifest is not a guess about what another package might do; it is the lifetime `registerIocFromManifest` will register, in the same container, under the same key.

This matters most for groups, because a group edge is checked at generation and nowhere else — member slots are lazy, so Awilix strict mode has no resolution stack to rank a member against no matter how it is configured. A composed group root merges with the local one and the **union** is ranked, so a locally empty root whose members all arrive by composition is checked, and so is the mixed root. A member whose lifetime no manifest this run read can state is printed as `UNRANKED, not cleared` rather than passed over in silence.

Two operational consequences:

- **Regenerate libraries before the app.** The check can only rank what the app's run could see. Generating the app against a stale composed manifest ranks the local members and no others, and nothing anywhere ranks the rest.
- **Expect findings on the first app-mode run after upgrading to 4.1.** Cross-boundary edges were previously classified as externals and skipped. See [Upgrading to 4.1](/concepts/lifetimes#lifetime-inversion-checks).

An app's confidence in a walk through a composed package is also bounded by what that package's manifest vouches for — see [`dependencyKeysComplete`](/guide/what-gets-generated#manifest-feature-tokens).

---
