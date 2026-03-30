# ioc-manifest

**Contract-first IoC for TypeScript.** Discover factory functions, generate a typed Awilix manifest, and register implementations with predictable keys—plus optional **groups** that collect every implementation assignable to a shared base type.

This package is aimed at teams that want compile-time clarity (what is registered, under which keys, with which lifetimes) without maintaining registration boilerplate by hand.

---

## Features

- **Discovery** — Scans your source tree with configurable globs; uses the TypeScript program from your `tsconfig.json` so return types and dependency shapes are real, not guessed.
- **Generated manifest** — Emits `ioc-manifest.ts` (runtime metadata + static imports) and `ioc-registry.types.ts` (cradle / container typing).
- **Awilix integration** — `registerIocFromManifest` registers factories, default-slot aliases, plural **collection** keys for multi-implementation contracts, and **group** roots.
- **Configuration** — `ioc.config.ts` controls discovery paths, per-implementation overrides (`name`, `lifetime`, `default`), contract-level `accessKey`, and **groups** (`collection` vs `object` over a `baseType`).
- **Inspection** — Library APIs and a small CLI (`ioc inspect`) to validate manifests and compare live discovery to what you think is registered.

---

## Prerequisites

- **Node.js** (current LTS recommended)
- **TypeScript** project with a root `tsconfig.json`
- **Awilix** as your DI container (`awilix` is a direct dependency when you use the runtime helpers)

---

## Installation

```bash
npm install ioc-manifest
```

The published artifact includes `dist/` (compiled ESM + types) and `bin/ioc.cjs` (CLI shim).

> **Note:** This repository’s `package.json` may set `"private": true` during development. For npm publishing, clear `private`, verify `"files"`, version, and run `npm publish` from a clean build.

---

## Concepts

| Term | Meaning |
|------|---------|
| **Contract** | The TypeScript interface / type alias your factory is understood to return (from the checker). |
| **Implementation** | One concrete factory + module for that contract (multiple implementations per contract are supported). |
| **Registration key** | The Awilix cradle property name for an implementation (derived from the export name or overridden in config). |
| **Default slot** | The singular key used to resolve the chosen default implementation for a contract (convention: camel-cased contract name, or `$contract.accessKey`). |
| **Collection key** | When a contract has more than one implementation, a plural key (e.g. `mediaStorages`) resolves to **all** implementations as an array. |
| **Group** | A named cradle key whose value is either an array (**collection**) or object (**object**) of implementations whose **declared contract types** are assignable to a configured `baseType`. |

---

## Quick start

### 1. Add IoC configuration

Create `src/ioc.config.ts` (default location). Use `defineIocConfig` for typing:

```typescript
import { defineIocConfig } from "ioc-manifest";

export default defineIocConfig({
  discovery: {
    rootDir: "src",
    includes: ["**/*.{ts,tsx}"],
    excludes: ["**/*.test.ts", "generated/**/*"],
    factoryPrefix: "build",
  },
  registrations: {
    // Contract name → implementation name → overrides
    MyService: {
      httpClient: { default: true, lifetime: "singleton" },
    },
  },
});
```

### 2. Implement factories

Use the configured prefix (default `build`) and export factory functions whose return type is your contract:

```typescript
import type { MyService } from "./MyService.js";

export const buildHttpClient = (): MyService => {
  /* ... */
};
```

### 3. Generate the manifest

From your app or CI:

```typescript
import { generateManifest } from "ioc-manifest";

await generateManifest();
```

Or add a script that runs the built CLI entry (this repo uses `tsx` during development):

```json
{
  "scripts": {
    "gen:manifest": "tsx node_modules/ioc-manifest/dist/generator/gen-manifest.js"
  }
}
```

After generation you should have (by default) `src/generated/ioc-manifest.ts` and `src/generated/ioc-registry.types.ts`.

### 4. Register with Awilix at runtime

```typescript
import { createContainer, asClass } from "awilix";
import {
  registerIocFromManifest,
  extractGroupRootsFromContainerManifest,
} from "ioc-manifest";
import type { IocGeneratedCradle } from "./generated/ioc-registry.types.js";
import { iocManifest } from "./generated/ioc-manifest.js";

const container = createContainer<IocGeneratedCradle>();

registerIocFromManifest(
  container,
  iocManifest.contracts,
  iocManifest.moduleImports,
  extractGroupRootsFromContainerManifest(iocManifest),
);

// Resolve by registration key or group root as typed on IocGeneratedCradle
const svc = container.resolve("myService");
```

If you do not use **groups**, pass `undefined` as the fourth argument (or omit if your helper allows).

---

## Configuration reference

### `discovery`

| Field | Description |
|-------|-------------|
| `rootDir` | Directory relative to project root (often `src`). |
| `includes` | fast-glob patterns relative to `rootDir`. |
| `excludes` | Ignore tests, `dist`, `node_modules`, etc. |
| `factoryPrefix` | Prefix for discoverable exports (default `build`). |
| `generatedDir` | Output folder relative to `rootDir`, or absolute (default `generated`). |

Merged options automatically exclude the configured generated directory so the scanner does not read its own output.

### `registrations`

Keyed by **contract name** (the TypeScript type name). Values are maps of **implementation name** → overrides.

- Special key **`$contract`** (`IOC_CONTRACT_CONFIG_KEY`): contract-level metadata (e.g. `accessKey` for the default slot).
- Per-implementation keys may set `name` (Awilix key), `lifetime`, `default`.

Rules enforced at generation time include: at most one `default: true` per contract when using config flags, globally unique registration keys, and no collision between access keys, collection keys, and other contracts’ keys.

### `groups`

```typescript
groups: {
  handlers: { kind: "collection", baseType: "CommandHandler" },
  servicesByContract: { kind: "object", baseType: "DomainService" },
}
```

- **`collection`** — Ordered array of every matching implementation’s **registration key** (with filters so “default slot only” duplicates are not listed twice incorrectly).
- **`object`** — Keys are **contract keys** (camel-cased contract names); values are the **default** implementation for each matching contract.

Group root names must not collide with `moduleImports`, `contracts`, or any existing registration key.

---

## CLI

After build, the `ioc` binary runs the inspect CLI:

```bash
npx ioc inspect
npx ioc inspect --discovery
npx ioc inspect --config ./path/to/ioc.config.ts
```

- **`inspect`** — Loads the generated manifest (using the same config resolution as generation) and prints contracts, implementations, lifetimes, and validation messages.
- **`--discovery`** — Re-runs factory discovery from source without reading the manifest; useful for spotting drift before you regenerate.

---

## Library API highlights

| Export | Role |
|--------|------|
| `generateManifest` | Full codegen pipeline |
| `registerIocFromManifest` | Awilix registration from manifest slices |
| `extractGroupRootsFromContainerManifest` | Strip fixed keys → `IocGroupsManifest` |
| `defineIocConfig` / `loadIocConfig` | Config authoring & loading |
| `validateManifest` / `buildInspectionReport` | Programmatic checks |
| `runDiscoveryAnalysis` / `buildDiscoveryReport` | Discovery-only analysis |
| `IocResolutionError` | Structured errors with manifest-aware chains |

Full surface is available from the package root (`import { … } from "ioc-manifest"`).

---

## Generated files

**Do not edit generated files** (`ioc-manifest.ts`, `ioc-registry.types.ts`). If output is wrong, fix `ioc.config.ts`, factories, or this package’s inputs, then re-run generation.

---

## Error messages

Runtime and config validators prefix messages with `[ioc]` or `[ioc-config]` so you can grep logs quickly. Factory resolution wraps failures in `IocResolutionError` where the stack of contract / implementation frames is merged with Awilix’s resolution path.

---

## Scripts (development)

| Script | Purpose |
|--------|---------|
| `npm run build` | `tsc` to `dist/` |
| `npm test` | Node’s test runner over `src/**/*.test.ts` |
| `npm run gen:manifest` | Regenerate fixtures / example manifest in this repo |

---

## Design stance

- **Minimal runtime** — Heavy lifting is at build time; runtime focuses on registration and clear errors.
- **Flat Awilix cradle** — Registration keys share one namespace; the planner rejects collisions early.
- **TypeScript-grounded** — Discovery uses your compiler settings; no parallel mini-type system.

---

## License

License file not present in this repository; add one before publishing if you need explicit terms.
