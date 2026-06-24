# ioc-manifest

**Convention-based dependency discovery and codegen for [Awilix](https://github.com/jeffijoe/awilix).** Write factory functions, run the generator, get a fully typed IoC container — no manual registrations. Compose containers across packages in a monorepo with first-class support.

```
npm install ioc-manifest
```

---

## The problem

In most Node.js DI setups, every new service means another `container.register(...)` call, another import, another string key to keep in sync. Scale that to 50+ services and registration code becomes a maintenance burden. Awilix's `loadModules` helps, but you lose type safety — `container.resolve("userService")` returns `any` unless you maintain a cradle type by hand.

And once you have more than one package in a monorepo, the registration story gets worse: either one app's bootstrap scans into every other package's source (fragile, fights TypeScript's module resolution), or you duplicate registration glue everywhere.

## What this does

`ioc-manifest` scans your TypeScript source at **build time**, discovers factory functions by naming convention, infers their contracts and dependencies from the type system, and generates manifest and types files that hand directly to Awilix.

For a single-package project, that's two generated files:

1. **`ioc-manifest.ts`** — a registration manifest with every factory, its contract, lifetime, and module import
2. **`ioc-registry.types.ts`** — a fully typed `IocGeneratedCradle` interface for your container, plus an `IocExternals` interface describing dependencies the package expects from outside

For a monorepo where one app composes manifests from multiple packages, a third file appears in the app:

3. **`ioc-composed.ts`** — the composition glue: imports each package's manifest, intersects their cradle types into a single `AppCradle`, and emits compile-time assertions that every package's externals are satisfied.

Every factory is registered with the correct key and lifetime, the container is fully typed end-to-end, and you never write a registration line again.

The approach is loosely inspired by [StructureMap](https://structuremap.github.io/)'s registry scanning conventions from the .NET world — convention over configuration, with a single config file as the policy surface when you need to override defaults.

## What you get for free

- **Auto-discovery** — export `buildUserService` and it's registered as `userService` returning `UserService`
- **Typed container** — `container.resolve("userService")` returns `UserService`, not `any`
- **Plural collections** — two implementations of `MediaStorage` automatically get a `mediaStorages: ReadonlyArray<MediaStorage>` key
- **Default selection** — convention picks the default; override in config when you have multiple implementations
- **Externals are explicit** — every dependency a package expects from outside is tracked in a generated `IocExternals` interface
- **Cross-package composition** — apps in a monorepo can compose manifests from multiple packages with no scanning across boundaries
- **Compile-time satisfaction checks** — when composing, TypeScript fails compilation if any composed package's externals aren't satisfied
- **Lifetime-inversion safety** — generation fails when a longer-lived service would freeze a shorter-lived dependency (a singleton holding a scoped repository), catching a whole class of stale-state bugs statically
- **`ioc validate`** — a CI-friendly command that reports every cross-manifest problem at once
- **Works in dev and prod** — discovers from TypeScript source during development, and works just as well against a bundled single-file production build (see [Dev and production builds](#dev-and-production-builds))

---

## Library mode vs app mode

`ioc-manifest` has two modes. Which one applies depends on a single config field: `composedManifests`.

**Library mode** is the default. A package generates its own manifest and types. Factories in that package can declare dependencies on things the package itself supplies (other local factories) _and_ on things it expects from outside (externals). The generated `IocExternals` interface documents the external contract — what the package needs to be handed at composition time.

**App mode** is what you turn on when a package composes manifests from other packages. The app declares `composedManifests: ['@scope/pkg-a', '@scope/pkg-b']` in its config. Codegen produces the extra `ioc-composed.ts` file, intersects the participating cradle types, and emits the compile-time assertion that every composed package's externals are satisfied somewhere in the composition.

A single-package project stays in library mode and never thinks about composition. A monorepo with one or more apps that consume shared packages has library-mode packages and one or more app-mode apps.

The quick start below walks through library mode. App mode is covered in [Cross-package composition](#cross-package-composition).

---

## Quick start

This walks through a single-package setup in library mode.

### 1. Create factories

Write plain factory functions. The naming convention `build<Name>` is the only requirement. Each factory's first parameter is a **named local deps type** describing what it consumes.

```ts
// src/services/buildUserRepository.ts
export type UserRepository = {
  findById: (id: string) => Promise<User | undefined>;
};

export const buildUserRepository = (): UserRepository => ({
  findById: async (id) => db.users.find(id),
});
```

```ts
// src/services/buildUserService.ts
import type { UserRepository } from "./buildUserRepository.js";

export type UserService = {
  getUser: (id: string) => Promise<User | undefined>;
};

type UserServiceDeps = {
  userRepository: UserRepository;
};

export const buildUserService = ({
  userRepository,
}: UserServiceDeps): UserService => ({
  getUser: (id) => userRepository.findById(id),
});
```

The named-deps-type pattern is required. Factories cannot destructure directly from `IocGeneratedCradle`, and inline object literals (`({ foo, bar }: { foo: Foo; bar: Bar })`) aren't allowed either — codegen will reject both. The rule is: the first parameter must be a named `interface` or `type` alias.

Three reasons:

1. **The cradle is generated from your factories' declarations.** A factory declaring its inputs by referencing the cradle would be a chicken-and-egg loop — the cradle doesn't exist yet at the moment codegen reads the factory.

2. **The deps type is the factory's testable contract.** Exporting `type UserServiceDeps = { ... }` means tests can `import type { UserServiceDeps }`, build a literal satisfying it, and call the factory directly with no container at all (see [Testing](#testing) below). Inline literals aren't importable — tests would have to reconstruct the same shape by hand in every file, and that drifts.

3. **The deps type is documentation.** When someone opens the file, the named declaration sits at the top and says exactly what the factory consumes. Inline literals bury the contract inside the function signature, where it competes for attention with parameter names and the return type.

The cost is one extra line per factory. That's the deal.

### 2. Configure

Create `ioc.config.ts` at your package root or under `src/`:

```ts
import { defineIocConfig } from "ioc-manifest";

export default defineIocConfig({
  discovery: {
    scanDirs: "src",
    generatedDir: "generated",
  },
});
```

That's the minimal config. The generator scans `src/` for `build*` exports and writes output to `generated/`.

### 3. Generate

```bash
npx ioc generate
```

Run this after changing factories or config. The generator prints a summary:

```
Generated generated/ioc-manifest.ts — 12 module factory(ies), 8 contract(s).
```

You can also call `generateManifest()` programmatically if you need to integrate generation into a custom build script.

### 4. Bootstrap Awilix

```ts
import { createContainer, InjectionMode } from "awilix";
import { registerIocFromManifest } from "ioc-manifest";
import { iocManifest } from "./generated/ioc-manifest.js";
import type { IocGeneratedCradle } from "./generated/ioc-registry.types.js";

const container = createContainer<IocGeneratedCradle>({
  injectionMode: InjectionMode.PROXY,
});

registerIocFromManifest(container, [iocManifest]);

// Fully typed — no 'any', no string guessing
const userService = container.resolve("userService");
```

Note that `registerIocFromManifest` takes an **array** of manifests, even when there's only one. The array is set-like — ordering is irrelevant, and the same input always produces the same registrations.

That's all you need for most single-package applications. The sections below cover the conventions in more detail. For monorepo composition, see [Cross-package composition](#cross-package-composition).

---

## What gets generated

Here's what library-mode output looks like for a small app. You never edit these files — they're regenerated from source.

**`ioc-registry.types.ts`** — the typed cradle and externals:

```ts
/* AUTO-GENERATED. DO NOT EDIT. */
import type { Logger } from "../services/buildConsoleLogger.js";
import type { MediaStorage } from "../services/buildLocalMediaStorage.js";
import type { UserService } from "../services/buildUserService.js";
import type { Database } from "../types/Database.js";

export interface IocGeneratedCradle {
  logger: Logger;
  mediaStorage: MediaStorage;
  mediaStorages: ReadonlyArray<MediaStorage>;
  userService: UserService;
}

export interface IocExternals {
  database: Database;
}
```

`mediaStorages` (plural) appears automatically because there are multiple `MediaStorage` implementations.

`IocExternals` lists every dependency the package consumes from outside — keys destructured by factory deps types where no local factory supplies them. `IocGeneratedCradle` contains only what the package itself supplies. The two interfaces together describe the package's full contract: what it provides and what it needs.

When a package declares `scopeProvided`, those keys are emitted into a separate `IocScopeProvided` interface rather than `IocExternals`, with a JSDoc banner reminding you to register them onto a child scope:

```ts
export interface IocScopeProvided {
  viewerId: string;
}
```

The main manifest file also exports `IOC_SCOPE_PROVIDED_KEYS` (a `readonly` string tuple) so app code can reference the set — for example, to assert a request-scope helper covers the keys the current path resolves. See [`scopeProvided`](#scopeprovided).

**`ioc-manifest.ts`** — the registration data:

```ts
/* AUTO-GENERATED. DO NOT EDIT. */
import type {
  IocGeneratedContainerManifest,
  IocModuleNamespace,
} from "ioc-manifest";

import * as ioc_services_buildConsoleLogger from "../services/buildConsoleLogger.js";
import * as ioc_services_buildLocalMediaStorage from "../services/buildLocalMediaStorage.js";
// ... more imports ...

export const iocManifest = {
  manifestSchemaVersion: 2,
  moduleImports: [
    /* ... */
  ] as const satisfies readonly IocModuleNamespace[],
  contracts: {
    Logger: {
      consoleLogger: {
        exportName: "buildConsoleLogger",
        registrationKey: "consoleLogger",
        contractName: "Logger",
        implementationName: "consoleLogger",
        lifetime: "singleton",
        moduleIndex: 0,
        default: true,
        discoveredBy: "naming",
      },
    },
    // ... more contracts ...
  },
} as const satisfies IocGeneratedContainerManifest;
```

---

## How conventions work

### Factory discovery

The generator looks for exported functions whose name starts with `build` (configurable via `factoryPrefix`). For `buildHttpClient`:

| Concept                 | Derived value                                         |
| ----------------------- | ----------------------------------------------------- |
| **Contract**            | The return type's symbol name, e.g. `HttpClient`      |
| **Implementation name** | Strip prefix, lowercase first char → `httpClient`     |
| **Registration key**    | Same as implementation name by default → `httpClient` |
| **Default access key**  | Camel-cased contract name → `httpClient`              |

The contract type must be a named type (interface or type alias) that is imported or declared in the factory's file. Anonymous object literals, primitives, and union types are skipped.

### Default implementation selection

When a contract has only one implementation, it is the default. When there are multiple, the default is selected by this precedence:

1. **App override** — `default: true` in an app-mode `ioc.config` (highest precedence; only relevant when composing)
2. **Explicit** — `default: true` on exactly one implementation in the local `ioc.config`
3. **Convention** — the implementation whose registration key equals the camel-cased contract name (e.g. `mediaStorage` for `MediaStorage`)
4. **Single** — if only one implementation exists, it's the default

If the choice is ambiguous, generation fails with a clear error telling you what to do.

### Automatic collections

When a contract has more than one implementation, a plural collection key is auto-registered. `MediaStorage` with implementations `localMediaStorage` and `s3MediaStorage` gives you:

- `container.resolve("mediaStorage")` → the default `MediaStorage`
- `container.resolve("localMediaStorage")` → the local implementation
- `container.resolve("s3MediaStorage")` → the S3 implementation
- `container.resolve("mediaStorages")` → `ReadonlyArray<MediaStorage>` with all implementations

Pluralization handles common English patterns (`Service` → `services`, `Factory` → `factories`, `Cache` → `caches`).

This is the same fundamental idea behind having multiple implementations of a single interface in any IoC container: you can swap implementations by environment. Have one `ioc.config` for production that points to real services, a different one for development that uses local stubs, and a third for testing that wires in mocks — without touching any factory source code. The config is the only thing that changes.

### Dependency inference

The generator analyzes each factory's first parameter — the named deps type — to determine which keys the factory consumes. Every property in the deps type becomes a **demand**. If a demanded key has a corresponding `build*` factory in the same package, it's a local dependency. If not, it's an external (and appears in `IocExternals`).

Codegen validates type agreement across factories: if `buildA` declares `database: Knex` and `buildB` declares `database: PostgresClient`, codegen fails with both locations and the conflicting types named.

---

## `ioc.config.ts` — single source of policy

All registration policy lives in one file. Factory source files stay plain — no decorators, no metadata objects, no `RESOLVER` symbols.

```ts
import { defineIocConfig } from "ioc-manifest";

export default defineIocConfig({
  discovery: {
    /* where to scan */
  },
  registrations: {
    /* overrides per contract/implementation */
  },
  groups: {
    /* cross-contract grouping by base type (advanced) */
  },
  // app mode only:
  composedManifests: [
    /* package names to compose */
  ],
});
```

### `discovery`

| Field           | Purpose                                                                                                                                      | Default                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `scanDirs`      | **Required.** Directories to scan. String, string array, or array of `{ path, scope? }` objects. Paths must resolve within the package root. | —                                    |
| `includes`      | Glob patterns for files to include.                                                                                                          | `["**/*.{ts,tsx,js,mjs,cjs}"]`       |
| `excludes`      | Glob patterns for files to exclude.                                                                                                          | `["**/*.d.ts", "**/*.test.ts", ...]` |
| `factoryPrefix` | Export name prefix for factory discovery.                                                                                                    | `"build"`                            |
| `generatedDir`  | Output directory for generated files.                                                                                                        | `"generated"`                        |

### `registrations`

Override defaults, lifetimes, and keys per contract and implementation.

```ts
registrations: {
  MediaStorage: {
    s3MediaStorage: { default: true, lifetime: "singleton" },
    localMediaStorage: { lifetime: "transient" },
  },
  Knex: {
    $contract: { accessKey: "database" },
    pg: { default: true, lifetime: "singleton" },
  },
},
```

Under each contract name, keys are implementation names from discovery (`buildFoo` → `foo`). The reserved `$contract` key holds contract-level options.

| Per-implementation field | Effect                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`                   | Overrides the Awilix registration key                                                                                                                                                                                          |
| `lifetime`               | `"singleton"` \| `"scoped"` \| `"transient"`                                                                                                                                                                                   |
| `default`                | `true` to select this implementation as the contract default                                                                                                                                                                   |
| `source`                 | (app mode only) Resolve same-key conflicts across composed manifests. See [Cross-package composition](#cross-package-composition).                                                                                             |
| `allowLifetimeInversion` | Opt out of the lifetime-inversion check for this implementation. `true` allows all shorter-lived dependencies; a `string[]` allows only the listed demanded keys. See [Lifetime inversion checks](#lifetime-inversion-checks). |

| `$contract` field | Effect                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `accessKey`       | Overrides the cradle property name for the default slot (e.g. `"database"` instead of `"knex"`) |

### `lifetimeMarkers`

Declare marker interfaces that map to Awilix lifetimes. Any factory whose return type **declares** heritage to a marker (via `extends` or a type-alias `&` intersection) inherits that lifetime automatically.

```ts
lifetimeMarkers: {
  IScoped: "scoped",
  ITransient: "transient",
},
```

Keys are interface or type-alias names visible in the package's TypeScript program at codegen. Values are `singleton`, `scoped`, or `transient`. An empty object `{}` skips marker analysis.

Markers match by **declared inheritance**, not structural shape. Use `extends IScoped` on service or contract interfaces (or `type Foo = Bar & IScoped`). Empty marker interfaces are fine. See [Lifetime markers](#lifetime-markers).

**Lifetime precedence** (highest first):

1. `registrations[Contract][implementation].lifetime`
2. Lifetime marker on return type (`lifetimeMarkers`)
3. `discovery.scanDirs[].scope` (folder-scoped default)
4. Default: `singleton`

### `scopeProvided`

Some dependencies aren't built by any factory and never can be — they're **runtime values registered onto a child scope per unit of work**. The canonical case is a request: a `viewerId`, `tenantId`, or `requestId` known only when the request arrives, registered onto a per-request child scope and consumed by services resolved within it.

```ts
scopeProvided: ["viewerId", "publicLinkId"],
```

A factory destructures `viewerId` like any other dependency. No local factory supplies it, so without this declaration it'd be classified as an external and the composition's externals check would demand that _something build it_ — which nothing can. `scopeProvided` tells the generator the key is satisfied at runtime by scope registration, not by a factory.

Declared keys are emitted into a dedicated `IocScopeProvided` interface (instead of `IocExternals`) and excluded from the externals-satisfaction check. At runtime you register them yourself, onto the child scope, before resolving anything that depends on them:

```ts
const scope = container.createScope();
scope.register({ viewerId: asValue(user.id) });
const reader = scope.resolve("viewerAlbumReadService"); // works
```

**The contract is enforced at runtime, not compile time — by design.** Composition cannot verify that a runtime value will be registered; only the running container can. So if you resolve a scope-provided service from the root container, or from a scope that forgot to register the value, Awilix throws an `IocResolutionError` at resolution. It never returns a placeholder. That throw _is_ the safety guarantee — a scoped service can't silently resolve outside its scope.

**Composing without resolving needs no provision.** A package that composes a manifest containing scope-provided services but never resolves them — a background worker pulling jobs, say — provides nothing and inherits no obligation. The keys leave `IocExternals`, so the worker's composition is satisfied without it touching `viewerId` at all. You declare `scopeProvided` once, in the package that _demands_ the key; every consumer inherits the exemption.

**Generation-time guards:**

- Declaring a key that no factory demands → warning (`[ioc-config]`), usually a typo.
- Declaring a key that a local factory also builds → error. A key can't be both manifest-built and scope-provided.

This is distinct from the `scoped` **lifetime**: a scoped-lifetime service is _instantiated_ once per scope; a scope-provided _value_ is _injected_ into the scope at runtime. The two are independent — a service can be one without the other.

### App-mode fields

These only apply in app mode (a package that composes manifests from other packages):

| Field                  | Purpose                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `composedManifests`    | Array of package names whose manifests this app composes. Setting this turns on app mode.                                                            |
| `packageName`          | The local package's npm name. Used for self-reference detection. Falls back to `package.json` `name`; required if neither is available.              |
| `groupBaseTypeAliases` | Equivalence sets for canonical base type identifiers when hoisting produces mismatches. See [Cross-package composition](#cross-package-composition). |

| Library-mode-only field | Purpose                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `manifestExportPath`    | Informational. The path your `package.json` `exports` points at for the manifest. Default `./generated/ioc-manifest`. |

`composedManifests` and `manifestExportPath` are mutually exclusive — a config is either library or app mode.

---

## Cross-package composition

Once you have more than one package in a monorepo, you typically have one or more apps that compose manifests from shared libraries. This is what app mode is for.

### The model

Each package generates its own manifest in library mode, scanning only its own source. The app's config declares which packages it composes with via `composedManifests`. Codegen produces an extra file in the app — `ioc-composed.ts` — that imports each package's manifest, intersects their cradle types, and emits compile-time assertions that every composed package's externals are satisfied.

At runtime, the app passes the composed manifests array to `registerIocFromManifest`. Composition is set-like: ordering doesn't matter. Conflicts (two manifests supplying the same registration key) are hard errors by default, resolved via explicit `source` config.

### A monorepo example

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

### App config

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

### Required package exports

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

### Generated `ioc-composed.ts`

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

### App bootstrap

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

### Resolving same-key conflicts

If two composed manifests both supply the same Awilix registration key, composition fails with a hard error naming both manifests. Resolve via the `source` field:

```ts
registrations: {
  AlbumRepository: {
    albumRepository: { source: "local" }, // or "@example/lib-services"
  },
}
```

`source: "local"` picks the app's own factory; a package name picks that package's registration. There's no last-write-wins or array-position semantics — you decide explicitly which manifest's registration wins.

### Groups across manifests

If multiple composed packages declare contributors to the same group (e.g. several packages register `DiscountStrategy` implementations and all declare a `discountStrategies` collection group), the group merges across manifests. `container.resolve("discountStrategies")` returns the union.

For this to work, all contributors must reference the same canonical base type — typically by importing it from a shared contracts package. If npm hoisting produces a single physical file for the base type, identity matching works automatically.

In rare cases (version skew, peer-dep conflicts, nested installs) two contributors may end up with different physical paths for what is structurally the same type. The library reports this with a clear error and a remediation hint, including the exact config block to paste:

```ts
// in the app's ioc.config.ts
groupBaseTypeAliases: {
  discountStrategies: [
    "/path/to/a.ts:DiscountStrategy",
    "/path/to/b.ts:DiscountStrategy",
  ],
}
```

The library treats the listed identifiers as equivalent. This is an escape hatch, not a normal-path mechanism.

---

## Dev and production builds

Getting an IoC container to work across development (loose TypeScript source files) and production (a bundled single-file build) is a real headache. `ioc-manifest` handles both cases because the generated manifest uses static `import * as ...` statements rather than runtime filesystem scanning.

In **development**, the generator discovers factories from your TypeScript source tree and emits relative imports that point to your `.ts` files (via `.js` extensions for ESM). Everything resolves naturally through your dev toolchain (tsx, ts-node, etc.).

In **production**, if you bundle your app into a single file (esbuild, rollup, etc.), those same static imports get resolved and inlined by the bundler. The manifest doesn't do any filesystem scanning at runtime — it's just a data structure with pre-resolved imports. Your bundler treats it like any other module graph.

This was a deliberate design choice (and a painful one to get right). There's no `loadModules` glob at runtime, no dynamic `require`, no filesystem walking. The generated manifest is a plain TypeScript module that any bundler can tree-shake and inline.

---

## CLI: `ioc`

```bash
npx ioc                       # prints help
npx ioc generate              # discover factories, emit manifest + types (and ioc-composed.ts in app mode)
npx ioc generate -c ./ioc.config.test.ts   # generate with a specific config
npx ioc inspect               # loads the generated manifest and prints a summary
npx ioc inspect --discovery   # re-runs discovery without reading the manifest
npx ioc validate              # app mode: cross-manifest checks against composedManifests
npx ioc validate --json       # machine-readable issue list
```

| Flag                       | Purpose                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `--discovery`              | (inspect only) Re-run factory discovery and planning; don't read the generated manifest |
| `--json`                   | (validate only) Emit issues as JSON                                                     |
| `--config PATH`, `-c PATH` | Explicit path to `ioc.config.ts`                                                        |
| `--project PATH`           | Project directory for config resolution (default: cwd)                                  |

Set `IOC_DEBUG=1` for full stack traces on errors.

### `ioc validate`

A separate command from `generate` because they have different audiences. `generate` runs frequently during development and shouldn't fail on transient inconsistencies (a sibling package mid-refactor). `validate` is the pre-merge / pre-deploy gate.

`validate` loads every composed manifest, runs every cross-manifest check at once, and reports all issues — not just the first. It does not modify any files; pure inspection. Exit code is non-zero if any error-severity issue is reported.

Typical output for a failing run:

```
[app-config] registrations references unknown contract "Storge"
  Known local contracts: Logger.
  Known composed contracts: Logger, LoggingService, Storage, UploadService.
  Did you mean: "Storage"?
  Suggested fix: Fix the contract name in ioc.config.ts registrations, or add a factory for "Storge".

Validation failed: 1 error, 0 warnings.
```

Library-mode invocations print an informational message and exit 0 — there's nothing cross-manifest to validate.

Recommended workflow: `ioc generate` → `ioc validate` → `tsc --noEmit` → deploy.

---

## Testing

The named-deps-type pattern at the factory site enables three levels of testing, each with the ergonomics that fit:

### Factory-level (no container)

Most unit tests don't need a container. Import the factory, import its deps type, hand-build a stub, call the factory:

```ts
import { buildValidateOperationService } from "../src/...";
import type { ValidateOperationServiceDeps } from "../src/...";

const deps: ValidateOperationServiceDeps = {
  mediaItemReadRepository: {
    /* stub */
  },
  grantReadRepository: {
    /* stub */
  },
  albumMemberReadRepository: {
    /* stub */
  },
};
const svc = buildValidateOperationService(deps);
```

No container, no manifest, no awilix. TypeScript enforces what must be provided.

### Container-level with mocked externals

When you want the full container — testing wiring, lifetimes, multi-service interactions inside the package — register the package's manifest then fill `IocExternals` with `asValue` stubs:

```ts
import { createContainer, asValue } from "awilix";
import { registerIocFromManifest } from "ioc-manifest";
import { iocManifest } from "../src/generated/ioc-manifest.js";
import type {
  IocGeneratedCradle,
  IocExternals,
} from "../src/generated/ioc-registry.types.js";

const container = createContainer<IocGeneratedCradle>();
registerIocFromManifest(container, [iocManifest]);

const externals: IocExternals = {
  database: mockKnex,
  logger: silentLogger,
};
for (const [k, v] of Object.entries(externals)) {
  container.register({ [k]: asValue(v) });
}
```

The `IocExternals` type makes the external surface a typed checklist: forget one and TypeScript errors; add a new external dep in the package and every test breaks until updated.

### Test-specific manifest

For shared stubs across many tests, write stub factories under `tests/stubs/` and a separate `ioc.config.test.ts` scanning both `src` and `tests/stubs`. Generate a test manifest. Use as above. Run with `npx ioc generate -c ./ioc.config.test.ts`.

---

## Error handling

Errors are designed to tell you exactly what went wrong and what to do about it.

**Config errors** are prefixed `[ioc-config]` — unknown contracts in `registrations`, duplicate defaults, key collisions. These fail at generation time before any files are written.

**Discovery errors** are prefixed `[ioc]` — duplicate registration keys, unresolvable contract types, overlapping scan directories with conflicting scopes, factories destructuring directly from `IocGeneratedCradle` (use named deps types instead).

**Validation errors** are prefixed by category (`[externals]`, `[same-key-conflict]`, `[group-base-type]`, etc.) and emitted by `ioc validate`. Validate aggregates: a failing run reports every issue at once, not just the first.

**Runtime resolution errors** use `IocResolutionError` with structured dependency chains:

```
[ioc] Cannot build AlbumService using implementation albumService.

Resolution chain:
  AlbumService (albumService) [services/buildAlbumService.ts]
    -> MediaStorage (s3MediaStorage) [services/buildS3MediaStorage.ts]
      -> S3Client ✖ no registered implementation
```

Missing dependencies, cyclic references, lifetime violations, and factory exceptions are all caught and reported with the full resolution path.

A missing **scope-provided** value surfaces here too: resolving a service whose scope value wasn't registered produces a `no registered implementation` leaf for that key. If you see this for a key declared in `scopeProvided`, the fix is to register it onto the child scope before resolving — not to add a factory.

---

## Advanced usage

The basics — factory discovery, typed cradle, automatic collections — cover most applications. The features below are things you can reach for when your app grows or your architecture demands more structure.

### Lifetime markers

When services are organized by domain (`src/users/`, `src/orders/`) rather than by lifetime category, folder-scoped lifetimes fit poorly. **Lifetime markers** express cross-cutting lifetime policy via marker interfaces — the same **nominal** membership rules groups use (declared `extends`, not structural assignability).

#### Defining a marker

A marker is typically an empty interface (or a type alias you intersect with). Selective matching comes from **where you attach `extends`**, not from branding:

```ts
// shared types
export interface IScoped {}

export interface ITransient {}
```

#### Declaring markers

Map marker types to lifetimes in `ioc.config`:

```ts
lifetimeMarkers: {
  IScoped: "scoped",
  ITransient: "transient",
},
```

Keys are interface or type-alias names visible in the package's TypeScript program at codegen. Values are `singleton`, `scoped`, or `transient`. An empty object `{}` skips marker analysis.

#### Attaching markers to factories

Three attachment points, in order of locality. The pattern that fits your code best is usually the right one.

**Directly on the implementation type:**

```ts
export interface RequestTracingLogger extends LoggingService, IScoped {
  ping: () => string;
}
```

**On a shared contract** (every implementation of `LoggingService` becomes scoped):

```ts
export interface LoggingService extends IScoped {
  log: (msg: string) => void;
}
```

**On a group base type** — the cleanest pattern when implementations are already collected as a group. Every implementation in the group inherits the lifetime automatically:

```ts
export interface DiscountStrategy extends IScoped {
  applies: (order: Order) => boolean;
  calculate: (order: Order) => number;
}
```

Transitive inheritance does the rest. You attach the marker once on the right level of abstraction; codegen finds it on every implementation downstream.

#### Precedence

For any factory, the lifetime resolves in this order (highest first):

1. `registrations[Contract][impl].lifetime` — explicit per-impl override
2. Lifetime marker on the return type
3. `discovery.scanDirs[].scope` — folder-scoped default
4. Default: `singleton`

#### Multiple markers is a hard error

If a return type matches two markers, codegen errors and names both. Silent first-wins would create the worst kind of bug — a service's lifetime quietly differs from what the developer intended. Resolve by removing one marker from the inheritance chain or setting the lifetime explicitly via `registrations`.

#### Cross-package behavior

Marker types must be declared in source files visible to the package's TypeScript program at codegen — typically the same package's `src/`. Library packages bake their resolved lifetimes into their manifest at _their_ codegen time; composing apps do not re-run marker resolution on library factories. A library's choice of marker is invisible to consumers; what they see is the resolved lifetime in the registration.

### Folder-scoped lifetimes

Folder-scoped lifetimes are a **legacy pattern** for codebases where directory layout mirrors lifetime boundaries. For domain-organized code, prefer [lifetime markers](#lifetime-markers) instead.

If implementations are co-located by lifetime category, you can default lifetimes by scan root:

```ts
discovery: {
  scanDirs: [
    { path: "src/services", scope: "scoped" },
    { path: "src/repos", scope: "scoped" },
    { path: "src/infra", scope: "singleton" },
    { path: "src/handlers", scope: "transient" },
  ],
},
```

This came out of a real pattern: in a GraphQL API, services and repositories are scoped to the request, infrastructure clients (database pools, caches) are singletons, and HTTP handlers are transient. Instead of repeating that in `registrations` for every single factory, you express it structurally — the directory _is_ the policy.

Per-implementation overrides in `registrations` and lifetime markers take precedence over folder scope.

### Lifetime inversion checks

Awilix lifetimes have an ordering: a `singleton` lives for the life of the container, a `scoped` instance lives for one scope (typically one request), a `transient` is rebuilt on every resolve. When a longer-lived registration depends on a shorter-lived one, the longer-lived service captures a single instance of that dependency at first construction and reuses it forever — quietly defeating the shorter lifetime.

The classic case: a `singleton` that depends on a `scoped` repository holding a per-request unit-of-work. The singleton is built once, captures one repository, and every later request writes through that first request's transaction. Nothing throws; the state just silently goes stale. The consumer doesn't even have to touch the scoped resource — holding something that holds it is enough.

`ioc generate` catches this statically. It walks every dependency edge over the resolved graph and flags any edge where the dependency is shorter-lived than the consumer:

- **`singleton → scoped`** is an **error** — generation fails. This includes a scoped dependency reached through a group (a group with a scoped member) or a scope-provided key (per-request, so effectively scoped). It is almost never intentional.
- **`singleton → transient`** and **`scoped → transient`** are **warnings** (`[ioc]`-prefixed). A singleton legitimately holding a transient factory it constructs from per use is a real pattern, so these surface for review without blocking.

The check resolves each demanded key precisely — a specific registration key, a contract's default slot, a collection, a group's members, or a scope-provided key — so it names the exact dependency rather than guessing across a contract's implementations. Findings aggregate: every warning prints, and if there are errors, generation throws once with the full list rather than failing on the first one.

A typical error:

```
Lifetime inversion: 'grantSync' (singleton) depends on 'grantRepository' (scoped). A singleton freezes its scoped dependency at first construction, reusing it across all scopes. Register 'grantSync' as scoped (or shorter), or mark it intentional with registrations['Grant'].grantSync.allowLifetimeInversion.
```

The usual fix is the obvious one — the consumer should be `scoped`:

```ts
registrations: {
  GrantSync: {
    grantSync: { lifetime: "scoped" },
  },
},
```

**Intentional inversions.** If an inversion is deliberate — a singleton that holds a transient factory and constructs from it per call — opt out with `allowLifetimeInversion` on that implementation:

```ts
registrations: {
  ConnectionPool: {
    // allow all shorter-lived deps for this implementation:
    connectionPool: { allowLifetimeInversion: true },
    // or allow only specific demanded keys (preferred):
    // connectionPool: { allowLifetimeInversion: ["connectionFactory"] },
  },
},
```

Prefer the `string[]` form. `true` silences every inversion for that consumer — including ones you introduce later and didn't mean to. Listing the keys you're knowingly inverting keeps the rest of the check live. The field is config-only and never appears in the generated manifest.

### Groups

Groups collect implementations whose **contract types declare** `extends` on a shared base type (nominal membership — same rules as lifetime markers). There are two kinds — `collection` and `object` — and they solve different real-world problems. A group with no local members emits `[ioc-warn]` but still generates; members may come from other composed packages.

#### Collection groups: the strategy pattern

Say you have a pricing engine with five discount strategies, each implementing the same interface:

```ts
export type DiscountStrategy = {
  applies: (order: Order) => boolean;
  calculate: (order: Order) => number;
};

// buildVolumeDiscount.ts → DiscountStrategy
// buildSeasonalDiscount.ts → DiscountStrategy
// buildLoyaltyDiscount.ts → DiscountStrategy
// buildCouponDiscount.ts → DiscountStrategy
// buildBundleDiscount.ts → DiscountStrategy
```

Without groups, you'd have to manually wire all five into an array. With a collection group:

```ts
groups: {
  discountStrategies: {
    kind: "collection",
    baseType: "DiscountStrategy",
  },
},
```

Now `container.resolve("discountStrategies")` gives you `ReadonlyArray<DiscountStrategy>` — every implementation whose contract type declares `extends DiscountStrategy`, discovered automatically. Your strategy runner just iterates through the array:

```ts
type PricingEngineDeps = {
  discountStrategies: ReadonlyArray<DiscountStrategy>;
};

export const buildPricingEngine = ({
  discountStrategies,
}: PricingEngineDeps): PricingEngine => ({
  applyDiscounts: (order) => {
    for (const strategy of discountStrategies) {
      if (strategy.applies(order)) {
        order.discount += strategy.calculate(order);
      }
    }
    return order;
  },
});
```

Add a sixth strategy? Just create the factory. It shows up in the group automatically — no registration changes.

If you need strategies to run in a specific order, put ordering metadata on the strategy interface itself (e.g. a `priority` field) and sort at use time. The library never tries to order group members.

#### Object groups: bundling related services

Object groups are for when you have several services that implement a common base type and you want to access them as a keyed bundle rather than an array. A real example: in a GraphQL API, you might have a set of user-scoped read services that all need to be available on the resolver context:

```ts
export type ReadService = {
  readonly scope: "user";
};

// buildUserReadService.ts → UserReadService (extends ReadService)
// buildOrderReadService.ts → OrderReadService (extends ReadService)
// buildNotificationReadService.ts → NotificationReadService (extends ReadService)
```

```ts
groups: {
  readServices: {
    kind: "object",
    baseType: "ReadService",
  },
},
```

Now `container.resolve("readServices")` returns an object keyed by each contract's convention name — `{ userReadService: UserReadService, orderReadService: OrderReadService, ... }`. You can spread that straight onto your GraphQL context without importing each service individually.

#### Group validation

The generator validates that group names don't collide with implementation keys, access keys, or collection keys. If a base type has no assignable implementations, generation fails with an actionable error. Cross-manifest group composition is covered in [Cross-package composition](#cross-package-composition).

#### Consuming a group from the same package

A factory can consume a group declared in its own package. The group's aggregate type — the array for a collection, the keyed object for an object group — is generated, so there's no hand-written type to import. You name it by indexing the generated cradle inside your deps type:

```ts
import type { IocGeneratedCradle } from "./generated/ioc-registry.types.js";
import type { NotificationService } from "./channel-contracts.js";

type NotificationServiceDeps = {
  channels: IocGeneratedCradle["channels"];
};

export const buildNotificationService = ({
  channels,
}: NotificationServiceDeps): NotificationService => ({
  notifyAll: (to) => {
    channels.emailChannel.sendEmail(to);
    channels.smsChannel.sendSms(to);
  },
});
```

This is the one sanctioned use of `IocGeneratedCradle` in a factory. The [named-deps-type rule](#1-create-factories) still holds: the parameter binds to a named type (`NotificationServiceDeps`), and `IocGeneratedCradle["channels"]` appears only as a _type reference inside it_, to name the otherwise-unnameable group type. You still cannot bind the parameter directly to the cradle (`({ channels }: IocGeneratedCradle)`).

For an object group, members are keyed by their convention name — `channels.emailChannel`, `channels.smsChannel`, the same registration keys derived from `buildEmailChannel` and `buildSmsChannel`. A collection group indexes to `ReadonlyArray<BaseType>` instead.

A few things work as you'd expect:

- **Aliased imports.** `import { IocGeneratedCradle as Cradle }`, then `Cradle["channels"]`, resolves identically.
- **Cold start.** The reference resolves from your source, not from a previously generated file — so first-run generation, or generation after deleting the generated directory, works. There's no chicken-and-egg dependency on prior output.
- **Typos throw.** Indexing a key that is neither a registration nor a declared group — `IocGeneratedCradle["channel"]` when the group is `channels` — fails generation with a diagnostic naming the offending key, instead of silently resolving to `unknown`.

### Environment-specific configs

The separation between factory code and `ioc.config.ts` makes it straightforward to swap implementations by environment. Your factories don't change — the config (or the set of composed manifests) is the only thing that differs.

For a single-package app, point the generator at a different config:

```bash
npx ioc generate --config ./ioc.config.test.ts
```

For a monorepo app, you can swap `composedManifests` entries to compose with mock packages in tests:

```ts
// ioc.config.test.ts
composedManifests: [
  "@example/lib-storage-mock",  // a sibling test-only package
  "@example/lib-services",
],
```

Either way, factory source code doesn't change.

---

## Pitfalls and troubleshooting

**Manifest out of date** — regenerate after editing factories or `ioc.config`. The generated files are build artifacts; treat them like compiled output.

**Contract not discovered** — the factory's return type must resolve to a named type (interface or type alias). The contract symbol must be imported or declared in the same file as the factory. Anonymous `{ foo: string }` return types are silently skipped.

**Factory destructures `IocGeneratedCradle`** — not allowed. Use a named local deps type instead. The error message names the factory and shows the correct pattern.

**Duplicate registration keys within a manifest** — every implementation needs a globally unique Awilix key. If two factories produce the same key, rename the exports or use `registrations[Contract][impl].name` to override.

**Duplicate registration keys across composed manifests** — composition errors with both manifest sources named. Resolve via `registrations[Contract][impl].source` in the app's `ioc.config`.

**Overlapping scan directories with different scopes** — if a factory file matches multiple scan roots that specify different `scope` values, generation fails. Narrow the roots or set lifetimes per implementation in `registrations`.

**`registrations` for unknown contracts** — keys in `registrations` must match a discovered contract type name exactly. In app mode, that includes contracts from composed manifests. A typo fails with a list of what was actually discovered, locally and from composed packages.

**App mode codegen fails to resolve a composed package** — the package needs `./iocManifest` and `./iocTypes` subpath exports in its `package.json`. Until those are added, app codegen can't import the manifest.

**`_<Pkg>ExternalsAssert` fails to compile** — a composed package's externals are not satisfied by the composition. Add a factory in the app (or in another composed package) that supplies the missing key, or compose another manifest that does.

**Group base type mismatch across manifests** — caused by hoisting producing different physical paths for the same logical type. The error includes the remediation block to paste into `groupBaseTypeAliases`.

**Library-mode invocation of `ioc validate`** — prints an informational message and exits 0. Validate is a cross-manifest tool; a library has no cross-manifest concerns to validate.

**My factory isn't in the group (or didn't get the marker lifetime)** — membership is **nominal**: the contract or return type must declare `extends YourBase` (or `type Foo = Bar & YourMarker`). Structural similarity is not enough. Common mistakes: forgetting `extends` on the service interface; using a union return type such as `Foo | undefined` on the contract — unions are not heritage, so `type Contract = Impl | undefined` will not join a group whose base is `Impl` unless you use `interface Contract extends Impl` instead.

**Every factory in the package got the same lifetime** (v1.1.x and earlier) — that was structural matching on empty markers. Upgrade to v1.2.0+ and use `extends` on the types that should be scoped; empty markers are safe when inheritance is declared explicitly.

**A singleton silently reuses a per-request dependency** — if a `singleton` depends (directly or through a chain) on a `scoped` or scope-provided value, it captures one instance at first construction and never refreshes it; per-request state goes stale with no runtime error. `ioc generate` fails on `singleton → scoped` edges for exactly this reason. Make the consumer `scoped`, or mark deliberate cases with `allowLifetimeInversion`. See [Lifetime inversion checks](#lifetime-inversion-checks).

---

## Design philosophy

This package is **not** an IoC container. It is a codegen layer over Awilix that trades manual registration for convention.

- **Factories are plain functions.** No decorators, no base classes, no `RESOLVER` symbols. A factory is an exported function that takes a named deps type and returns a value.
- **Policy lives in one file.** Lifetimes, defaults, and key overrides are in `ioc.config.ts` — never scattered across factory sources. Looking at a factory tells you _what_ it builds; looking at the config tells you _how_ it's registered.
- **Types are inferred, not declared.** The generator reads the TypeScript program to discover contracts, dependencies, and assignability. You don't maintain a parallel type registry.
- **Library packages own their boundary.** Each package generates its own manifest. What it supplies appears in `IocGeneratedCradle`; what it expects from outside appears in `IocExternals`. The contract is explicit and machine-readable.
- **App-mode composition is set-like.** `registerIocFromManifest(container, [a, b, c])` is order-independent. Conflicts are hard errors with explicit resolution, never silent override.
- **Errors fail fast and explain themselves.** Ambiguous defaults, key collisions, missing externals, and base-type mismatches are caught at generation, validation, or compile time — with messages that name the problem, suggest a fix, and where possible give you the exact config block to paste.
- **Static imports, not runtime scanning.** The generated manifest is a plain TypeScript module with static imports. It works in dev with loose source files and in production with a single bundled file — no filesystem walking at runtime.

---

## Installation

```bash
npm install ioc-manifest
```

Your app should already have **Awilix** installed — `ioc-manifest` lists it as a dependency for type and runtime alignment.

`ioc-manifest` bundles `typescript` and `prettier` as dependencies because it uses the TypeScript compiler API for source analysis and Prettier for formatting generated output. If your project uses a different TypeScript version, they coexist without conflict (the generator uses its own copy).

---

## License

MIT — see [LICENSE](./LICENSE).
