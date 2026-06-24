# Introduction

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

## Library mode vs app mode

`ioc-manifest` has two modes. Which one applies depends on a single config field: `composedManifests`.

**Library mode** is the default. A package generates its own manifest and types. Factories in that package can declare dependencies on things the package itself supplies (other local factories) _and_ on things it expects from outside (externals). The generated `IocExternals` interface documents the external contract — what the package needs to be handed at composition time.

**App mode** is what you turn on when a package composes manifests from other packages. The app declares `composedManifests: ['@scope/pkg-a', '@scope/pkg-b']` in its config. Codegen produces the extra `ioc-composed.ts` file, intersects the participating cradle types, and emits the compile-time assertion that every composed package's externals are satisfied somewhere in the composition.

A single-package project stays in library mode and never thinks about composition. A monorepo with one or more apps that consume shared packages has library-mode packages and one or more app-mode apps.

The quick start below walks through library mode. App mode is covered in [Cross-package composition](/monorepo/composition).

---

## Installation

```bash
npm install ioc-manifest
```

Your app should already have **Awilix** installed — `ioc-manifest` lists it as a dependency for type and runtime alignment.

`ioc-manifest` bundles `typescript` and `prettier` as dependencies because it uses the TypeScript compiler API for source analysis and Prettier for formatting generated output. If your project uses a different TypeScript version, they coexist without conflict (the generator uses its own copy).

---
