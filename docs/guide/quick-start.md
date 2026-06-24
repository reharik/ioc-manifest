# Quick start

This walks through a single-package setup in library mode.

## 1. Create factories

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

2. **The deps type is the factory's testable contract.** Exporting `type UserServiceDeps = { ... }` means tests can `import type { UserServiceDeps }`, build a literal satisfying it, and call the factory directly with no container at all (see [Testing](/guide/testing) below). Inline literals aren't importable — tests would have to reconstruct the same shape by hand in every file, and that drifts.

3. **The deps type is documentation.** When someone opens the file, the named declaration sits at the top and says exactly what the factory consumes. Inline literals bury the contract inside the function signature, where it competes for attention with parameter names and the return type.

The cost is one extra line per factory. That's the deal.

## 2. Configure

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

## 3. Generate

```bash
npx ioc generate
```

Run this after changing factories or config. The generator prints a summary:

```
Generated generated/ioc-manifest.ts — 12 module factory(ies), 8 contract(s).
```

You can also call `generateManifest()` programmatically if you need to integrate generation into a custom build script.

## 4. Bootstrap Awilix

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

That's all you need for most single-package applications. The sections below cover the conventions in more detail. For monorepo composition, see [Cross-package composition](/monorepo/composition).

---
