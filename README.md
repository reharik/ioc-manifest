# ioc-manifest

**Compile-time dependency registration for Awilix (PROXY mode).**

This library is **not an IoC container**. Instead, it generates a fully-typed registration manifest for Awilix, allowing you to use Awilix’s **PROXY injection mode** without manually wiring dependencies.

It works by **discovering factory functions in your codebase**, inferring their contracts from TypeScript, and generating:

- A runtime manifest for registering dependencies with Awilix
- Strongly-typed container (cradle) definitions
- Predictable registration keys based on conventions

The result is a system where:

- Dependencies are wired **by convention, not manual registration**
- The container remains **flat and predictable**
- All registrations are **visible and validated at build time**

---

## Design philosophy

This library is intentionally opinionated:

- **Function-first** — designed for factory functions (`buildX`) rather than classes or decorators
- **Awilix PROXY mode** — dependencies are injected via parameter destructuring, not constructor injection
- **Convention over configuration** — naming and return types drive registration
- **No runtime magic** — all discovery happens at build time using the TypeScript compiler

---

## When to use this

Use `ioc-manifest` if you:

- Use (or want to use) **Awilix in PROXY mode**
- Prefer **plain functions over classes**
- Want **zero manual registration boilerplate**
- Care about **strong typing of your container**

Avoid it if you:

- Prefer class-based DI frameworks (e.g. NestJS, Inversify)
- Rely on decorators or runtime reflection
- Need highly dynamic or runtime-defined registrations

---

## Mental model

```
Factory → Implementation → Contract → Registration → Container
```

- You write **factories**
- The generator infers **contracts**
- It produces a **manifest**
- The runtime registers everything into Awilix

---

## Key derivation (important)

Given a factory:

```ts
export const buildHttpClient = (): MyService => { ... }
```

We derive:

- **Contract** → `MyService` (from return type)
- **Implementation name** → `httpClient` (from function name without prefix)
- **Default access key** → `myService` (camel-cased contract name)

Result:

```ts
container.resolve("myService"); // default implementation
container.resolve("httpClient"); // specific implementation
container.resolve("myServices"); // array (if multiple implementations exist)
```

You can override these via config.

---

## Contract detection rules

A factory is associated with a contract if:

- Its return type is explicitly annotated, OR
- TypeScript can resolve a concrete return type via the compiler

Factories without a resolvable return type are skipped.

---

## Features

- **Discovery** — Scans your source tree using your `tsconfig.json`
- **Generated manifest** — Emits runtime + type-safe container definitions
- **Awilix integration** — Registers everything with correct lifetimes and keys
- **Configuration** — Override naming, defaults, lifetimes, and access keys
- **Groups** — Aggregate implementations by shared base type
- **Inspection CLI** — Debug and validate your dependency graph

---

## Quick start

### 1. Add IoC configuration

```ts
import { defineIocConfig } from "ioc-manifest";

export default defineIocConfig({
  discovery: {
    rootDir: "src",
    includes: ["**/*.{ts,tsx}"],
    excludes: ["**/*.test.ts", "generated/**/*"],
    factoryPrefix: "build",
  },
});
```

---

### 2. Implement factories

```ts
import type { MyService } from "./MyService.js";

export const buildHttpClient = (): MyService => {
  return {
    doThing: () => "hello",
  };
};
```

---

### 3. Generate the manifest

```ts
import { generateManifest } from "ioc-manifest";

await generateManifest();
```

---

### 4. Register with Awilix

```ts
import { createContainer } from "awilix";
import { registerIocFromManifest } from "ioc-manifest";

import { iocManifest } from "./generated/ioc-manifest.js";
import type { IocGeneratedCradle } from "./generated/ioc-registry.types.js";

const container = createContainer<IocGeneratedCradle>();

registerIocFromManifest(container, iocManifest);

const svc = container.resolve("myService");
```

---

## Groups

Groups let you collect implementations across contracts using a shared base type.

### Example

```ts
groups: {
  handlers: { kind: "collection", baseType: "CommandHandler" },
}
```

If multiple factories return types assignable to `CommandHandler`:

```ts
container.resolve("handlers");
// → [createUserHandler, deleteUserHandler, ...]
```

### Group types

- **collection** → array of implementations
- **object** → map of contract → default implementation

---

## CLI (important)

Use the CLI to debug your system:

```bash
npx ioc inspect
npx ioc inspect --discovery
```

### Why this matters

- See what was discovered
- Detect missing contracts
- Validate config before runtime

**Tip:** Run `--discovery` when something “isn’t registering”.

---

## Configuration reference

### discovery

| Field           | Description                    |
| --------------- | ------------------------------ |
| `rootDir`       | Root directory (usually `src`) |
| `includes`      | Files to scan                  |
| `excludes`      | Files to ignore                |
| `factoryPrefix` | Prefix for factories (`build`) |
| `generatedDir`  | Output directory               |

---

### registrations

Override behavior per contract:

```ts
registrations: {
  MyService: {
    httpClient: { default: true, lifetime: "singleton" },
  },
}
```

Supports:

- `default`
- `lifetime`
- `name` (override registration key)
- `$contract.accessKey` (override default slot)

---

## Generated files

- `ioc-manifest.ts` — runtime registration data
- `ioc-registry.types.ts` — typed container (cradle)

**Do not edit these manually.**

---

## Error handling

Errors are prefixed:

- `[ioc]` — runtime
- `[ioc-config]` — config issues

Resolution errors include dependency chains for debugging.

---

## Why not decorators?

Unlike decorator-based DI systems:

- No runtime metadata
- No decorators required
- Works with plain functions
- Full compile-time visibility

---

## Design stance

- **Minimal runtime** — all heavy work happens at build time
- **Flat container** — single namespace, no hidden nesting
- **TypeScript-grounded** — uses your compiler, not a custom type system

---

## License

Add a license before publishing.
