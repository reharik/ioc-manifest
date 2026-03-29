# ioc-manifest

TypeScript-first IoC generation + runtime registration for [Awilix](https://github.com/jeffijoe/awilix).

This package is designed around a simple workflow:

1. You write injectable factory modules in TypeScript (type-safe, contract-first).
2. You generate stable IoC metadata + generated cradle typings.
3. Your application registers everything into an Awilix container at runtime using generated artifacts.

## What this package provides

### Runtime API (used by applications)

- `registerIocFromManifest(container, manifestByContract, moduleImports, groupsManifest?)`

This registers:

- implementation factories (single contract default slot and explicit named keys)
- contract default aliases (when the “default slot key” differs from the selected default implementation key)
- multi-implementation collections (plural slot returning an object map)
- optional **groups**: named `collection` or `object` aggregations of implementations whose **declared contract type** is assignable to a configured `baseType` (see `groups` in `ioc.config.ts` and the generated `iocManifest.groups` field)

### Generation tool (dev-time only)

The repository includes a generator that discovers factories using TypeScript type analysis and emits:

- `ioc-manifest.ts` (runtime metadata: contracts, implementations, module import list, optional `groups`)
- `ioc-manifest.support.ts` (full registration manifest with `moduleIndex` / `relImport` for the runtime)
- `ioc-registry.types.ts` (typed cradle interface for your container)

Generated files are written via atomic temp-file replacement (no pre-delete of existing generated outputs).

### Calling the generator from your app or build script

`generateManifest` is exported from the package root so consumers do not need to deep-import `src/generator/...`:

```ts
import { generateManifest } from "ioc-manifest";

// Uses project root + default discovery; optional explicit ioc.config path:
await generateManifest({ iocConfigPath: "./src/ioc.config.ts" });
```

Related exports for customizing paths and merging with `ioc.config.ts`:

- `resolveManifestOptions`, `mergeManifestOptionsWithIocConfig`, `DEFAULT_MANIFEST_OPTIONS`
- Types: `ManifestOptions`, `ManifestRuntimePaths`
- Group planning: `buildGroupPlan`, `analyzeGroupPlan`, `formatGroupPlanIssue`, etc.

The generator depends on `typescript`, `fast-glob`, and `prettier` at install time (they are listed as `dependencies` of `ioc-manifest`).

## Install

```bash
npm i ioc-manifest
```

## Runtime usage (recommended)

### Prerequisites

- You have generated the files:
  - `src/generated/ioc-manifest.ts`
  - `src/generated/ioc-registry.types.ts`
- Those generated files are configured for your application’s discovery settings (generated directory, factory prefix, etc.).

### Example

```ts
import { createContainer } from "awilix";
import { registerIocFromManifest } from "ioc-manifest";

import { iocManifest } from "./generated/ioc-manifest.js";
import { iocRegistrationManifest } from "./generated/ioc-manifest.support.js";
import type { IocGeneratedCradle } from "./generated/ioc-registry.types.js";

const container = createContainer<IocGeneratedCradle>({
  injectionMode: "PROXY",
});

registerIocFromManifest(
  container,
  iocRegistrationManifest,
  iocManifest.moduleImports,
  iocManifest.groups,
);

// Resolve by keys produced in generation:
const mediaStorage = container.resolve("mediaStorage");
const mediaStorages = container.resolve("mediaStorages");
```

### Configuring groups (`ioc.config.ts`)

Groups select implementations by TypeScript assignability of each **contract’s declared type** to a named `baseType` (interface or type alias in your program):

```ts
groups: {
  mediaBackends: {
    kind: "collection",
    baseType: "MediaStorage",
  },
  mediaByKey: {
    kind: "object",
    baseType: "MediaStorage",
  },
},
```

- `collection`: registered value is a `ReadonlyArray` of resolved implementations (manifest order).
- `object`: registered value is a plain object whose keys are implementation **registration keys**.

Unknown `baseType`, zero matches, or duplicate registration keys in an `object` group are reported at generation time.

## Runtime semantics (important)

### 1. Factories are always invoked with the Awilix cradle

During registration, `ioc-manifest` registers each generated factory as an Awilix “asFunction” factory and invokes the discovered resolver factory with the cradle/deps object.

This guarantees compatibility with all supported factory shapes:

- `(deps) => Contract`
- `() => Contract` (JS ignores the extra argument)
- `(deps = {}) => Contract` (default params still receive the cradle even when JS `.length` is 0)

### 2. Collection lifetime rules

For contracts with multiple implementations, the generator creates a collection registration that returns:

- `Record<implementationName, instance>`

The lifetime of that collection is derived from member lifetimes:

- `transient` if any member is `transient`
- `scoped` if none are `transient` but at least one member is `scoped`
- `singleton` otherwise

### 3. Default implementation selection + aliasing

For each contract:

- there is a generated default “slot key”
- exactly one implementation is selected as the runtime default

If the generated contract default slot key is not already registered by the selected default implementation, `registerIocFromManifest` registers an alias from the contract default slot key to the selected default implementation key.

## Generation (dev-time)

### Inputs

The generator expects:

- a TypeScript project with a resolvable `tsconfig.json`
- a discovery root and include/exclude glob patterns (defaults are in the repository)
- an optional `src/ioc.config.ts` that can override:
  - lifetime
  - which implementation is the contract default
  - the Awilix registration key used for an implementation
  - **`groups`**: `kind` + `baseType` for generated aggregate registrations

### Config loading notes

`ioc.config.ts` is loaded via dynamic `import()`.

If your config file is TypeScript (`.ts`), you must run generation in a TS-aware environment (for example using `tsx`), so the config module can be imported.

### Determinism and atomic writes

The generator is designed to be stable across repeated runs:

- discovered target files are processed deterministically
- each output file is written to a temp file and then replaced using `rename`
- existing generated outputs are not pre-deleted at the start of generation

### Generated outputs expected by the runtime

Your app should use (imports in runtime):

- `ioc-manifest.ts`: `iocManifest` (includes `moduleImports`, `contracts`, optional `groups`)
- `ioc-manifest.support.ts`: `iocRegistrationManifest`
- `ioc-registry.types.ts`: `IocGeneratedCradle`

## CLI (this package)

```bash
ioc inspect [--config <path>]
ioc inspect --discovery [--config <path>]
```

## Generator scripts (in this repository)

If you are running generation inside this repo (or in a workspace that has the generator sources):

```bash
npm run gen:manifest
npm test
npm run build
```

## Debugging and troubleshooting

### “Could not resolve”

This generally means the key you are resolving is not present in `IocGeneratedCradle` and not registered by `registerIocFromManifest`.

Check:

- you ran generation after adding/updating factories
- the implementation is included by the generator discovery include/exclude patterns
- config overrides did not rename the implementation keys unexpectedly

### “has no function export …”

The runtime checks that each generated `exportName` exists on the corresponding module import namespace.

Fix:

- ensure the factory export exists and is a function
- ensure the generator’s discovery rules correctly locate the factory export

### Type import mismatch / contract symbol conflicts

These issues are caught during generation with helpful error messages when implementations disagree on contract type import source.

## Supported factory patterns (what the generator expects)

Factories are TypeScript exports that the generator can discover as injectable factories. In general:

- zero-arg factories are supported
- dependency-injected factories are supported (the generator uses TypeScript type info)
- default parameter factories are supported by runtime cradle invocation semantics

If you need generator-specific naming rules (like the default `build*` prefix), configure them in discovery settings.

## License

MIT (or add your project’s license here).
