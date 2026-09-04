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
| `factoryPrefix` | Export name prefix for factory discovery. (Class units trigger on `implements`, not on a prefix.)                                            | `"build"`                            |
| `generatedDir`  | Output directory for generated files.                                                                                                        | `"generated"`                        |

Whatever `excludes` says, the scan never descends into a `node_modules` or `.git` directory and never follows a symbolic link. A directory under `node_modules` is another package by definition, and cross-package scanning was removed in v2 — `scanDirs` already refuses a path outside the package root, and a symlink out of it is the same boundary crossed by other means. Setting `excludes` replaces the defaults, so these are stated where a walk can actually be pruned by them rather than left to a pattern list a config may drop.

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

Under each contract name, keys are implementation names from discovery — the camelCased export name past the prefix for a factory (`buildFoo` → `foo`), or the camelCased class name for a class unit (`S3MediaStorage` → `s3MediaStorage`). The reserved `$contract` key holds contract-level options.

| Per-implementation field | Effect                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `name`                   | Overrides the Awilix registration key                                                                                              |
| `lifetime`               | `"singleton"` \| `"scoped"` \| `"transient"`                                                                                       |
| `default`                | `true` to select this implementation as the contract default                                                                       |
| `source`                 | (app mode only) Resolve same-key conflicts across composed manifests. See [Cross-package composition](/monorepo/composition). |
| `allowLifetimeInversion` | Opt out of the lifetime-inversion check for this implementation. `true` allows all shorter-lived dependencies; a `string[]` allows only the listed demanded keys. See [Lifetime inversion checks](/concepts/lifetimes#lifetime-inversion-checks). |

| `$contract` field    | Effect                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `accessKey`          | Overrides the cradle property name for the default slot (e.g. `"database"` instead of `"knex"`). Note that it is written into the manifest, so a library's `accessKey` also decides the slot key of the merged contract in every app that composes it. |
| `allowDivergentName` | **Deprecated, no longer read.** It suppressed the divergent-name advisory, which was retired when contract slot keys joined the static layers: the implementation key and the contract key no longer mean the same thing (`impl: Named<C>` vs `contractKey: C`), so a divergence between them is not a second name for one thing. Still accepted by the schema, so existing configs keep validating; setting it does nothing. See [Demanding a dependency](/concepts/conventions#demanding-a-dependency-the-five-things-a-deps-property-can-be). |

### `classes`

Per-class options for [class registration units](/concepts/classes), keyed by class name. Registration keys, lifetimes, and defaults for classes live in `registrations` exactly as they do for factories — this surface holds only the two things specific to the class trigger.

```ts
classes: {
  DualUnit: { contract: "Auditor" },
  S3MediaStorage: { allowDivergentFileName: true },
},
```

| Field                    | Effect                                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract`               | Selects which `implements` entry is the contract, for a class that lists more than one. Without it, several entries is a hard error naming the class and each contract. |
| `allowDivergentFileName` | `true` suppresses the migration warning for a class whose file stem would have produced a different key under Awilix `loadModules`. See [Migrating from `loadModules`](/guide/migrating-from-loadmodules). |

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

### `dependencyKeyCoverage`

How loudly generation reports accepted units whose deps parameter it could not read. `"warn"` (the default), `"error"`, or `"off"`.

```ts
dependencyKeyCoverage: "error",
```

Dependency keys are derived syntactically, from a destructured first parameter and nothing else. A factory written `(deps: Deps)`, `({ a, ...rest }: Deps)`, or with a computed or nested binding records no demand at all — and a unit with no recorded demand is skipped by the [lifetime-inversion check](/concepts/lifetimes#lifetime-inversion-checks), ends a [scope-root subtree walk](/concepts/scope-roots#verification), and withholds [`dependencyKeysComplete`](/guide/what-gets-generated#manifest-feature-tokens) for its whole package. The report names each offender by file, line and export, quotes the parameter, and gives the fix for that particular shape.

It **warns** by default rather than failing, because these factories run correctly — Awilix hands the cradle over as that one object and every property read resolves. What is defective is the generator's view of the code, not the code, and failing a build over working code on a check that did not exist a release ago teaches teams to switch the check off. Use `"error"` once a package is clean and you want CI to hold the line.

`"off"` silences the message and nothing else. **The coverage token follows the code, not the setting** — a package with unreadable factories withholds `dependencyKeysComplete` at every level, so every composing app still learns that a subtree through it cannot be walked.

### `manageGitignore`

Whether a successful generation may add `.ioc-generation-state.json` to the `.gitignore` beside it, creating that file if there is none. Default `true`.

```ts
manageGitignore: false,
```

On by default because the alternative is a trap rather than a preference: the record carries a timestamp, so it changes on every run, and a consumer who commits it and runs an unscoped `git diff --exit-code` in CI gets a red build forever over a file that is pure local diagnostics. See [the CLI reference](/reference/cli#two-worlds-the-staleness-banner) for what is written and what is left alone.

Set it `false` if ignores are managed centrally — a workspace-root `**/.ioc-generation-state.json` covers every package, and generation cannot see it from inside one, so it would otherwise add a redundant entry per package. Nothing about the record or the freshness check depends on this setting; it governs the `.gitignore` write and nothing else.

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
