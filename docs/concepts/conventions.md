# How conventions work

## Factory discovery

The generator looks for exported functions whose name starts with `build` (configurable via `factoryPrefix`). For `buildHttpClient`:

| Concept                 | Derived value                                         |
| ----------------------- | ----------------------------------------------------- |
| **Contract**            | The return type's symbol name, e.g. `HttpClient`      |
| **Implementation name** | Strip prefix, lowercase first char → `httpClient`     |
| **Registration key**    | Same as implementation name by default → `httpClient` |
| **Default access key**  | Camel-cased contract name → `httpClient`              |

The contract type must be a named type (interface or type alias) that is imported or declared in the factory's file. Anonymous object literals, primitives, and union types are skipped.

## Default implementation selection

When a contract has only one implementation, it is the default. When there are multiple, the default is selected by this precedence:

1. **App override** — `default: true` in an app-mode `ioc.config` (highest precedence; only relevant when composing)
2. **Explicit** — `default: true` on exactly one implementation in the local `ioc.config`
3. **Convention** — the implementation whose registration key equals the camel-cased contract name (e.g. `mediaStorage` for `MediaStorage`)
4. **Single** — if only one implementation exists, it's the default

If the choice is ambiguous, generation fails with a clear error telling you what to do.

## Multiple implementations

When a contract has more than one implementation, each is registered under its own key and one is selected as the default for the contract's access key. `MediaStorage` with implementations `localMediaStorage` and `s3MediaStorage` gives you:

- `container.resolve("mediaStorage")` → the default `MediaStorage`
- `container.resolve("localMediaStorage")` → the local implementation
- `container.resolve("s3MediaStorage")` → the S3 implementation

To resolve *all* implementations of a base type as an array, declare a [collection group](/concepts/groups) — that is the single mechanism for aggregate resolution.

This is the same fundamental idea behind having multiple implementations of a single interface in any IoC container: you can swap implementations by environment. Have one `ioc.config` for production that points to real services, a different one for development that uses local stubs, and a third for testing that wires in mocks — without touching any factory source code. The config is the only thing that changes.

## Divergent-name warning

When a contract has exactly **one** implementation whose registration key differs from the contract access key — e.g. `buildCreateMediaItemUpload` returning `CreateMediaUpload` — the container ends up with two cradle names for one thing: the implementation key (`createMediaItemUpload`) and the default-slot alias (`createMediaUpload`). All injection sites use the alias, so grepping for the implementation name finds nothing, which makes the factory's usage hard to trace. Because a single-implementation contract gets none of the benefits of the dual naming, `ioc generate` warns:

```
[ioc] Contract "CreateMediaUpload" has a single implementation "createMediaItemUpload" registered as
"createMediaItemUpload", but injection sites resolve it through the contract key "createMediaUpload" ...
```

Fix it by renaming the factory (`buildCreateMediaUpload`) or the contract (`CreateMediaItemUpload`) so the keys match — then no alias is registered and there is a single greppable name. If the divergence is intentional, suppress the warning:

```ts
registrations: {
  CreateMediaUpload: {
    $contract: { allowDivergentName: true },
  },
},
```

The warning never fires for multi-implementation contracts (distinct names are the point there), for contracts with an explicit `$contract.accessKey` (the second name was requested by hand), or for group bases with no elected default (no singular key is emitted).

Group **members** are not exempt: a contract that extends a group's base type is still an ordinary contract with its own keys — an object group exposes each member under its contract key (`writeServices.createMediaUpload`), so a divergent single-implementation member has the same traceability problem and warns like any other contract. Only a factory returning the group base type *itself* (with no elected default) is skipped.

## Dependency inference

The generator analyzes each factory's first parameter — the named deps type — to determine which keys the factory consumes. Every property in the deps type becomes a **demand**. If a demanded key has a corresponding `build*` factory in the same package, it's a local dependency. If not, it's an external (and appears in `IocExternals`).

Codegen validates type agreement across factories: if `buildA` declares `database: Knex` and `buildB` declares `database: PostgresClient`, codegen fails with both locations and the conflicting types named.

---
