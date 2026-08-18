# How conventions work

## The two registration units

A **registration unit** is one thing the container knows how to build. There are two kinds, and each is recognised by a trigger you write deliberately:

| Unit kind   | Trigger                                             | Contract site           |
| ----------- | --------------------------------------------------- | ----------------------- |
| **Factory** | Exported name starts with `build` (`factoryPrefix`) | Return type annotation  |
| **Class**   | Exported class carries an `implements` clause       | The `implements` clause |

```ts
// Factory unit — `build` prefix, contract in the return annotation.
export const buildHttpClient = ({ logger }: HttpClientDeps): HttpClient => ({ ... });

// Class unit — `implements` clause, contract in that clause.
export class HttpClient implements HttpTransport { ... }
```

Neither trigger is inferred from shape. A function that happens to return an `HttpClient` but isn't named `build*` is ordinary code; a class with no `implements` is ordinary code. That is the point — whether something is registered is answerable by looking at the declaration, not by reasoning about the type system.

## Contract identity

**A unit's contract is what you wrote at its contract site, read syntactically.** The generator resolves the name at that site to the declaration it names, and the contract is that declaration. No type normalization takes part: the checker is used only to find where a name is declared.

Two consequences worth internalising:

**Import aliases are followed; type aliases are not.** `import { MediaStorage as Store }` annotated as `Store` is the contract `MediaStorage` — an aliased import names the same declaration. But `type QueueTask = WorkerTaskBase` used as an annotation is the contract `QueueTask`, distinct from `WorkerTaskBase`, because you wrote `QueueTask` and that is a declaration of its own.

**Identity is the pair (declaration file, declared name).** Two different declarations that happen to share a name are two contracts, and generation fails naming both declaration sites rather than silently merging them under one manifest key.

### Explicit annotations are required

Every factory that matches the prefix must declare a return type annotation naming its contract. A prefix-matched export without one fails generation, with one aggregated error listing every offender — that list is your worklist:

```ts
export const buildUserService = ({ userRepository }: UserServiceDeps) => ({ ... });
//                                                                    ^ no annotation → error
```

`Promise<T>` and parentheses are unwrapped syntactically, so an async factory annotates the contract it eventually produces:

```ts
export const buildUserService = async (deps: Deps): Promise<UserService> => { ... };
```

Inline object literals (`(): { get: () => User } =>`) and anonymous unions (`(): EmailTask | SmsTask =>`) are also errors: a contract must be a named type, so that the cradle has something to import. Name it and the error goes away.

### Plain type aliases are contracts

Any named type works as a contract — `interface`, `type` alias, or an alias naming a union:

```ts
export type QueueTask = WorkerTaskBase;                 // a contract
export type Task = EmailTask | SmsTask;                 // also a contract
export interface UserService { getUser(id: string): User }
```

::: tip Upgrading from v2
Through v2, contract identity came from the checker, and a plain alias collapsed into whatever it aliased. Declaring a distinct contract over a base type meant the empty-interface dance — `export interface QueueTask extends WorkerTaskBase {}` — and converting that to a plain alias (as several lint autofixes do) silently broke discovery.

Both are gone in v3: the alias *is* the contract. **Existing `interface Foo extends Base {}` declarations keep working exactly as before** — an empty extending interface is still a perfectly good named type. There is nothing you must change; you can now simplify if you want to.
:::

## Registration keys

One camelCase rule covers both unit kinds and the contract access key: Awilix's own `formatName: "camelCase"` algorithm, ported so a codebase migrating off `loadModules` keeps its container keys.

| Written                        | Key              |
| ------------------------------ | ---------------- |
| `buildHttpClient` / `HttpClient` | `httpClient`   |
| `buildS3MediaStorage` / `S3MediaStorage` | `s3MediaStorage` |
| `buildAPIClient` / `APIClient` | `apiClient`      |
| `buildHTTPSProxy` / `HTTPSProxy` | `httpsProxy`   |

Words split on separators and on case transitions, so an acronym run splits as a word: `API|Client`, not `A|PIClient`. The same name gives the same key whichever unit kind supplies it.

For `buildHttpClient`:

| Concept                 | Derived value                                          |
| ----------------------- | ------------------------------------------------------ |
| **Contract**            | The name at the contract site, e.g. `HttpClient`        |
| **Implementation name** | Strip prefix, camelCase → `httpClient`                  |
| **Registration key**    | Same as implementation name by default → `httpClient`   |
| **Default access key**  | camelCased contract name → `httpClient`                 |

Override any key with `registrations[Contract][implementation].name`.

## Default implementation selection

When a contract has only one implementation, it is the default. When there are multiple, the default is selected by this precedence:

1. **App override** — `default: true` in an app-mode `ioc.config` (highest precedence; only relevant when composing)
2. **Explicit** — `default: true` on exactly one implementation in the local `ioc.config`
3. **Convention** — the implementation whose registration key equals the camel-cased contract name (e.g. `mediaStorage` for `MediaStorage`)
4. **Single** — if only one implementation exists, it's the default

If the choice is ambiguous, generation fails with a clear error telling you what to do. A class and a factory implementing the same contract compete for the default exactly as two factories do — unit kind carries no precedence.

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

The generator analyzes each unit's dependency parameter — a factory's first parameter, or a class constructor's single destructured object parameter — to determine which keys it consumes. Every property in that **named deps type** becomes a **demand**. If a demanded key is supplied by a unit in the same package, it's a local dependency. If not, it's an external (and appears in `IocExternals`).

Codegen validates type agreement across units: if `buildA` declares `database: Knex` and `buildB` declares `database: PostgresClient`, codegen fails with both locations and the conflicting types named.

---
