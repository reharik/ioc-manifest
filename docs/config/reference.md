# Configuration

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

| Per-implementation field | Effect                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `name`                   | Overrides the Awilix registration key                                                                                              |
| `lifetime`               | `"singleton"` \| `"scoped"` \| `"transient"`                                                                                       |
| `default`                | `true` to select this implementation as the contract default                                                                       |
| `source`                 | (app mode only) Resolve same-key conflicts across composed manifests. See [Cross-package composition](/monorepo/composition). |
| `allowLifetimeInversion` | Opt out of the lifetime-inversion check for this implementation. `true` allows all shorter-lived dependencies; a `string[]` allows only the listed demanded keys. See [Lifetime inversion checks](/concepts/lifetimes#lifetime-inversion-checks). |

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

Markers match by **declared inheritance**, not structural shape. Use `extends IScoped` on service or contract interfaces (or `type Foo = Bar & IScoped`). Empty marker interfaces are fine. See [Lifetime markers](/concepts/lifetimes#lifetime-markers).

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
| `groupBaseTypeAliases` | Equivalence sets for canonical base type identifiers when hoisting produces mismatches. See [Cross-package composition](/monorepo/composition). |

| Library-mode-only field | Purpose                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `manifestExportPath`    | Informational. The path your `package.json` `exports` points at for the manifest. Default `./generated/ioc-manifest`. |

`composedManifests` and `manifestExportPath` are mutually exclusive — a config is either library or app mode.

---

## Environment-specific configs

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
