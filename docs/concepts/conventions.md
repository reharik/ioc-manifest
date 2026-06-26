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

## Dependency inference

The generator analyzes each factory's first parameter — the named deps type — to determine which keys the factory consumes. Every property in the deps type becomes a **demand**. If a demanded key has a corresponding `build*` factory in the same package, it's a local dependency. If not, it's an external (and appears in `IocExternals`).

Codegen validates type agreement across factories: if `buildA` declares `database: Knex` and `buildB` declares `database: PostgresClient`, codegen fails with both locations and the conflicting types named.

---
