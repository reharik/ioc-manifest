# `@ioc-config/runtime`

TypeScript-first IoC manifest generator and runtime registrar for Awilix.

## What it does

- Discovers injectable factory modules from your source tree.
- Uses TypeScript type analysis to map each factory to a contract.
- Generates:
  - `src/generated/ioc-manifest.ts`
  - `src/generated/ioc-registry.types.ts`
- Registers implementations, defaults, and collections into an Awilix container at runtime.

## Runtime and config expectations

- Node.js runtime: modern ESM Node (project is configured for ES modules and TypeScript `moduleResolution: "bundler"`).
- TypeScript project must have a resolvable `tsconfig.json` from the project root.
- `ioc.config.ts` is optional; when present it must export a valid IoC config.
- Generated files are expected to live under your configured generated directory (default `src/generated`).

## Generate manifest

```bash
npm run gen:manifest
```

This command writes generated files atomically by replacing each target file only after new content is ready. Existing generated files are not pre-deleted.

## Validate locally

```bash
npm run test
npm run build
```

## Runtime usage

```ts
import { createContainer } from "awilix";
import { registerIocFromManifest } from "@ioc-config/runtime";
import { iocManifestByContract, iocModuleImports } from "./generated/ioc-manifest.js";
import type { IocGeneratedCradle } from "./generated/ioc-registry.types.js";

const container = createContainer<IocGeneratedCradle>({ injectionMode: "PROXY" });
registerIocFromManifest(container, iocManifestByContract, iocModuleImports);
```
