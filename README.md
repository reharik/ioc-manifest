# ioc-manifest

**Convention-based dependency discovery and codegen for [Awilix](https://github.com/jeffijoe/awilix).** Write factory functions, run the generator, get a fully typed IoC container — no manual registrations.

```
npm install ioc-manifest
```

---

## The problem

In most Node.js DI setups, every new service means another `container.register(...)` call, another import, another string key to keep in sync. Scale that to 50+ services and registration code becomes a maintenance burden. Awilix's `loadModules` helps, but you lose type safety — `container.resolve("userService")` returns `any` unless you maintain a cradle type by hand.

## What this does

`ioc-manifest` scans your TypeScript source at **build time**, discovers factory functions by naming convention, infers their contracts and dependencies from the type system, and generates two files:

1. **`ioc-manifest.ts`** — a registration manifest with every factory, its contract, lifetime, and module import
2. **`ioc-registry.types.ts`** — a fully typed `IocGeneratedCradle` interface for your container

Hand those to Awilix and you're done. Every factory is registered with the correct key and lifetime, the container is fully typed, and you never write a registration line again.

The approach is loosely inspired by [StructureMap](https://structuremap.github.io/)'s registry scanning conventions from the .NET world — convention over configuration, with a single config file as the policy surface when you need to override defaults.

## What you get for free

- **Auto-discovery** — export `buildUserService` and it's registered as `userService` returning `UserService`
- **Typed container** — `container.resolve("userService")` returns `UserService`, not `any`
- **Plural collections** — two implementations of `MediaStorage` automatically get a `mediaStorages: ReadonlyArray<MediaStorage>` key
- **Default selection** — convention picks the default; override in config when you have multiple implementations
- **Works in dev and prod** — discovers from TypeScript source during development, and works just as well against a bundled single-file production build (see [Dev and production builds](#dev-and-production-builds))

---

## Quick start

### 1. Create factories

Write plain factory functions. The naming convention `build<Name>` is the only requirement.

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
import type { IocGeneratedCradle } from "../generated/ioc-registry.types.js";

export type UserService = {
  getUser: (id: string) => Promise<User | undefined>;
};

export const buildUserService = ({
  userRepository,
}: IocGeneratedCradle): UserService => ({
  getUser: (id) => userRepository.findById(id),
});
```

Dependencies are declared via parameter destructuring against the generated cradle type. After generation, TypeScript tells you exactly what's available.

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

registerIocFromManifest(container, iocManifest);

// Fully typed — no 'any', no string guessing
const userService = container.resolve("userService");
```

That's all you need for most applications. The sections below cover the conventions in more detail, and the [Advanced usage](#advanced-usage) section covers features you can reach for when your app grows — folder-scoped lifetimes, groups, monorepo support, and environment-specific configs.

---

## What gets generated

Here's what the output looks like for a small app. You never edit these files — they're regenerated from source.

**`ioc-registry.types.ts`** — the typed cradle:

```ts
/* AUTO-GENERATED. DO NOT EDIT. */
import type { Logger } from "../services/buildConsoleLogger.js";
import type { MediaStorage } from "../services/buildLocalMediaStorage.js";
import type { UserService } from "../services/buildUserService.js";

export interface IocGeneratedTypes {
  logger: Logger;
  mediaStorage: MediaStorage;
  mediaStorages: ReadonlyArray<MediaStorage>;
  userService: UserService;
}

export type IocGeneratedCradle = IocGeneratedTypes;
```

Notice `mediaStorages` (plural) — that appeared automatically because there are multiple `MediaStorage` implementations.

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

1. **Explicit** — `default: true` on exactly one implementation in `ioc.config`
2. **Convention** — the implementation whose registration key equals the camel-cased contract name (e.g. `mediaStorage` for `MediaStorage`)
3. **Single** — if only one implementation exists, it's the default

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

The generator analyzes each factory's first parameter to determine which contracts it depends on. If `buildUserService` destructures `{ userRepository }` and `UserRepository` is a known contract, the manifest records that dependency relationship. This powers the resolution chain in error messages.

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
});
```

### `discovery`

| Field                         | Purpose                                                                                                                      | Default                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `scanDirs`                    | **Required.** Directories to scan. String, string array, or array of `{ path, scope?, importPrefix?, importMode? }` objects. | —                                    |
| `includes`                    | Glob patterns for files to include.                                                                                          | `["**/*.{ts,tsx,js,mjs,cjs}"]`       |
| `excludes`                    | Glob patterns for files to exclude.                                                                                          | `["**/*.d.ts", "**/*.test.ts", ...]` |
| `factoryPrefix`               | Export name prefix for factory discovery.                                                                                    | `"build"`                            |
| `generatedDir`                | Output directory for generated files.                                                                                        | `"generated"`                        |
| `workspacePackageImportBases` | Maps workspace roots to bare specifiers for generated imports (see [Monorepo support](#monorepo-support-importprefix)).      | —                                    |

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

| Per-implementation field | Effect                                                       |
| ------------------------ | ------------------------------------------------------------ |
| `name`                   | Overrides the Awilix registration key                        |
| `lifetime`               | `"singleton"` \| `"scoped"` \| `"transient"`                 |
| `default`                | `true` to select this implementation as the contract default |

| `$contract` field | Effect                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `accessKey`       | Overrides the cradle property name for the default slot (e.g. `"database"` instead of `"knex"`) |

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
npx ioc generate              # discover factories, emit manifest + types
npx ioc generate -c ./ioc.config.test.ts   # generate with a specific config
npx ioc inspect               # loads the generated manifest and prints a summary
npx ioc inspect --discovery   # re-runs discovery without reading the manifest
npx ioc inspect --config ./src/ioc.config.ts --project ./packages/api
```

| Flag                       | Purpose                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `--discovery`              | (inspect only) Re-run factory discovery and planning; don't read the generated manifest |
| `--config PATH`, `-c PATH` | Explicit path to `ioc.config.ts`                                                        |
| `--project PATH`           | Project directory for config resolution (default: cwd)                                  |

Set `IOC_DEBUG=1` for full stack traces on errors.

---

## Error handling

Errors are designed to tell you exactly what went wrong and what to do about it.

**Config errors** are prefixed `[ioc-config]` — unknown contracts in `registrations`, duplicate defaults, key collisions. These fail at generation time before any files are written.

**Discovery errors** are prefixed `[ioc]` — duplicate registration keys, unresolvable contract types, overlapping scan directories with conflicting scopes.

**Runtime resolution errors** use `IocResolutionError` with structured dependency chains:

```
[ioc] Cannot build AlbumService using implementation albumService.

Resolution chain:
  AlbumService (albumService) [services/buildAlbumService.ts]
    -> MediaStorage (s3MediaStorage) [services/buildS3MediaStorage.ts]
      -> S3Client ✖ no registered implementation
```

Missing dependencies, cyclic references, lifetime violations, and factory exceptions are all caught and reported with the full resolution path.

---

## Advanced usage

The basics — factory discovery, typed cradle, automatic collections — cover most applications. The features below are things you can reach for when your app grows or your architecture demands more structure.

### Folder-scoped lifetimes

If you find yourself setting `lifetime: "scoped"` on dozens of individual services and repositories, you probably want folder-scoped lifetimes instead. Rather than annotating each factory, you tell the generator that everything under a directory defaults to a specific lifetime:

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

Per-implementation overrides in `registrations` always take precedence, so you can still make exceptions when needed.

### Groups

Groups let you collect implementations across contracts by their assignability to a base type. There are two kinds — `collection` and `object` — and they solve different real-world problems.

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

Now `container.resolve("discountStrategies")` gives you `ReadonlyArray<DiscountStrategy>` — every implementation that's assignable to the base type, discovered automatically. Your strategy runner just iterates through the array:

```ts
export const buildPricingEngine = ({
  discountStrategies,
}: IocGeneratedCradle): PricingEngine => ({
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

The generator validates that group names don't collide with implementation keys, access keys, or collection keys. If a base type has no assignable implementations, generation fails with an actionable error.

### Monorepo support (`importPrefix`)

In a monorepo, factories in one package often return types defined in another. Without configuration, the generated manifest would emit deep relative paths like `../../../packages/shared/src/types/UserService.js` — fragile and ugly.

`importPrefix` and `importMode` fix this. They tell the generator how to write import statements for factories discovered under a given scan root:

```ts
discovery: {
  scanDirs: [
    {
      path: "packages/shared/src",
      importPrefix: "@acme/shared",
      importMode: "subpath",
    },
    {
      path: "packages/api/src",
      importPrefix: "@acme/api",
      importMode: "subpath",
    },
  ],
},
```

With `importMode: "subpath"`, a factory at `packages/shared/src/services/buildLogger.ts` gets imported as `@acme/shared/services/buildLogger.js` in the generated manifest — matching your package's published exports. With `importMode: "root"`, it would emit just `@acme/shared`.

For contract type imports (the `import type` lines in `ioc-registry.types.ts`), use `workspacePackageImportBases` to achieve the same mapping:

```ts
discovery: {
  scanDirs: "packages/api/src",
  workspacePackageImportBases: [
    { root: "packages/shared", importBase: "@acme/shared" },
  ],
},
```

This ensures the generated types file uses `import type { UserService } from "@acme/shared"` instead of a deep relative path into another package's source tree.

### Environment-specific configs

The separation between factory code and `ioc.config.ts` makes it straightforward to swap implementations by environment. Your factories don't change — the config is the only thing that differs:

```ts
// ioc.config.ts (production)
registrations: {
  EmailService: {
    sesEmailService: { default: true },
  },
  Cache: {
    redisCache: { default: true, lifetime: "singleton" },
  },
},
```

```ts
// ioc.config.test.ts (testing)
registrations: {
  EmailService: {
    mockEmailService: { default: true },
  },
  Cache: {
    inMemoryCache: { default: true, lifetime: "transient" },
  },
},
```

Point the generator at a different config with `npx ioc generate --config ./ioc.config.test.ts` and you get a completely different wiring — all mocks, all stubs, whatever you need — without touching a single factory file.

---

## Pitfalls and troubleshooting

**Manifest out of date** — regenerate after editing factories or `ioc.config`. The generated files are build artifacts; treat them like compiled output.

**Contract not discovered** — the factory's return type must resolve to a named type (interface or type alias). The contract symbol must be imported or declared in the same file as the factory. Anonymous `{ foo: string }` return types are silently skipped.

**Duplicate registration keys** — every implementation needs a globally unique Awilix key. If two factories produce the same key, rename the exports or use `registrations[Contract][impl].name` to override.

**Overlapping scan directories with different scopes** — if a factory file matches multiple scan roots that specify different `scope` values, generation fails. Narrow the roots or set lifetimes per implementation in `registrations`.

**`registrations` for unknown contracts** — keys in `registrations` must match discovered contract type names exactly. A typo fails with a list of what was actually discovered.

**`inspect` shows `lifetimeSource: factory-config`** — this means the lifetime came from `ioc.config`, not from the factory source file (the label is historical).

---

## Design philosophy

This package is **not** an IoC container. It is a codegen layer over Awilix that trades manual registration for convention.

- **Factories are plain functions.** No decorators, no base classes, no `RESOLVER` symbols. A factory is an exported function that takes a cradle and returns a value.
- **Policy lives in one file.** Lifetimes, defaults, and key overrides are in `ioc.config.ts` — never scattered across factory sources. Looking at a factory tells you _what_ it builds; looking at the config tells you _how_ it's registered.
- **Types are inferred, not declared.** The generator reads the TypeScript program to discover contracts, dependencies, and assignability. You don't maintain a parallel type registry.
- **Errors fail fast and explain themselves.** Ambiguous defaults, key collisions, and missing contracts are caught at generation time with messages that name the problem and suggest the fix.
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
