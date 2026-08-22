# Consuming generated types

Your factories can reference the types the generator writes — a cradle key's type, a group's aggregate type. This page is the complete rule for how.

## The rule, in one line

**Naming a generated type is always legal. Reading *into* one is legal only as `IocGeneratedCradle["<string literal>"]`.**

Everything below follows from that.

## Why there is a rule at all

Generation must never type-check its own prior output. The generated file is an *input* to the next generation only if you let it be — and letting it be produces a bug that doesn't announce itself:

- **On a warm run**, the checker reads the *previous* `ioc-registry.types.ts` and hands back last generation's types, which get baked into the new output. Generation succeeds. The result is wrong, and stays wrong until someone notices a type is a generation behind.
- **On a cold run** — first generation, or after deleting the generated directory — the same reference resolves to `any` or fails outright.

So every reference from your source to the generated file is recognised *syntactically*, off the AST and the module specifier text, and is either resolved against the in-memory manifest or rejected with a pointed error. There is no third outcome; a form that were neither would fall through to the checker, which is the silent-wrong-output case. The enumeration is explicit in the source (`generatedReferenceForms.ts`) and the tests key off the same list, so the claim and the coverage can't drift apart.

## Supported forms

**Import the generated names any ordinary way.** Named, aliased, inline-type, and namespace imports all resolve:

```ts
import type { Channels, IocGeneratedCradle } from "./generated/ioc-registry.types.js";
import type { IocGeneratedCradle as Cradle } from "./generated/ioc-registry.types.js";
import { type Channels } from "./generated/ioc-registry.types.js";
import type * as Ioc from "./generated/ioc-registry.types.js";
```

**Index the cradle with a single string literal.** One property per demanded key:

```ts
type UploadDeps = {
  storage: IocGeneratedCradle["storage"];
  albumRepository: Cradle["albumRepository"];
  logger: Ioc.IocGeneratedCradle["logger"];
};
```

**Reference a group alias by name.** Each group's aggregate type is exported as its access key in PascalCase:

```ts
type NotificationDeps = {
  channels: Channels;          // or: Ioc.Channels
};
```

**Stand a type alias in between**, in the same file or another module:

```ts
// deps-aliases.ts — this module, not the factory, imports the generated file
import type { Channels, IocGeneratedCradle } from "./generated/ioc-registry.types.js";
export type SharedChannels = Channels;
export type SharedStorage = IocGeneratedCradle["storage"];

// uploadService.ts
import type { SharedChannels, SharedStorage } from "./deps-aliases.js";
type UploadDeps = { storage: SharedStorage; channels: SharedChannels };
```

**Name a generated type without reading into it.** This is the composition-root pattern, and it stays legal because the name is only ever printed back:

```ts
const container = createContainer<IocGeneratedCradle>({ injectionMode: InjectionMode.PROXY });
```

## Rejected forms

Each fails generation with an error naming the file, the line, the offending text, why the form can't be supported, and what to write instead. Offenders across a run are aggregated into one error.

### Reading into a generated type

| Rejected                                     | Why                                                                    | Write instead                                          |
| -------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| `keyof IocGeneratedCradle`                   | Bakes a snapshot of the *previous* cradle's keys in — the key set lags a generation behind | Index the keys you need, or declare the union yourself |
| `interface Deps extends IocGeneratedCradle {}` | Absorbs every member of the previous cradle, re-demanding the whole stale registry next run | `type Deps = { storage: IocGeneratedCradle["storage"] }` |
| `Cradle["storage"]["put"]`                   | Reading a member *out* of an entry needs the entry's resolved type      | Index one key, then reach into the contract type in your own code |
| `Cradle[Key]`, `Cradle["a" \| "b"]`          | The demanded key must be readable off the source text                  | One string literal per demanded key                    |
| `Cradle<string>["storage"]`                  | Instantiating the generic before reading the key *is* type resolution   | `IocGeneratedCradle["storage"]`                        |
| `Channels["length"]`, `IocExternals["config"]` | Only `IocGeneratedCradle` carries resolvable registration keys        | `channels: Channels`, or `IocGeneratedCradle["channels"]` |
| `typeof Ioc`                                 | Asks for a module's inferred shape, which only prior output supplies    | Reference the type by name, or index a single key      |

### Reaching the generated file another way

| Rejected                                                     | Write instead                        |
| ------------------------------------------------------------ | ------------------------------------ |
| `import type Ioc from "…/ioc-registry.types.js"` (default import) | A named type import              |
| `import Ioc = require("…/ioc-registry.types.js")`             | A named or namespace type import     |
| `import Cradle = Ioc.IocGeneratedCradle`                      | `import type { IocGeneratedCradle as Cradle } from …` |
| `export = Ioc`                                                | Import directly; don't republish     |
| `export { IocGeneratedCradle } from …`                        | Import directly; don't re-export     |
| `export type { Channels } from …`                             | Import directly; don't re-export     |
| `export * from …` / `export * as ioc from …`                  | Import directly; don't re-export     |
| `import("…/ioc-registry.types.js").IocGeneratedCradle`        | A regular type import                |
| `typeof import("…/ioc-registry.types.js")`                    | A regular type import                |
| `/// <reference path="…/ioc-registry.types.ts" />`            | Delete it; use a type import         |

Re-exports are the one that surprises people: a barrel that does `export * from "./generated/ioc-registry.types.js"` gives consumers a name the interception cannot follow, so it's rejected at the barrel rather than at each consumer.

### In a deps type or return type specifically

A factory's deps type and return type are read member-by-member to build the new cradle, so a generated type reaching either position must be one of the two claimed forms. A structural backstop runs immediately before demand analysis would hand the type to the checker, and rejects shapes that are legal elsewhere but not here:

```ts
type Deps = { cradle: IocGeneratedCradle };            // rejected
type Deps = { chans: ReadonlyArray<Channels> };        // rejected
type Deps = Pick<IocGeneratedCradle, "storage">;       // rejected
type Deps = IocGeneratedCradle & { extra: Extra };     // rejected

type Deps = { storage: IocGeneratedCradle["storage"] }; // supported
type Deps = { channels: Channels };                     // supported
```

::: warning `ReadonlyArray<Channels>` was never right
A group alias **is already the collection type**. For a collection group `channels` over base `Channel`, the generator emits:

```ts
export type Channels = ReadonlyArray<Channel>;
```

So `channels: Channels` is the correct demand and `ReadonlyArray<Channels>` was always an array of arrays — it only ever produced output by reading the previous generated file. It is now rejected rather than silently wrong.
:::

`ReadonlyArray<Channels>` and `Pick<IocGeneratedCradle, …>` are the only two rejected shapes that used to produce output at all, and both produced it the wrong way.

### `Named<T>` and the claim forms

`Named<T>` — the marker that declares a demand for one specific implementation, see [Demanding a dependency](/concepts/conventions#demanding-a-dependency-the-five-things-a-deps-property-can-be) — is not a generated-type reference and never interacts with the forms above. It is read syntactically off the written annotation, before the claim parsers run, and the two can never both apply: every claim form rejects a type reference carrying type arguments, and `Named<T>` always carries one.

A property the claim parsers *do* claim is exempt from the marker requirement, implementation keys included:

```ts
// Both legal, and they mean the same thing:
type Deps = { s3Storage: Named<Storage> };
type Deps = { s3Storage: IocGeneratedCradle["s3Storage"] };
```

The indexed form has already said which cradle key it names, so the ambiguity the marker exists to remove is not present. A bare `s3Storage: Storage` is the one spelling that is now rejected.

## Typos throw

Indexing a key that is neither a registration nor a declared group — `IocGeneratedCradle["channel"]` when the group is `channels` — fails generation with a diagnostic naming the offending key, instead of resolving to `unknown`.

## Cold start works

Every supported form resolves from *your* source against the in-memory manifest, not from a previously generated file. First-run generation, and generation after deleting the generated directory, both work. There is no chicken-and-egg dependency on prior output — that property is what the whole enumeration exists to protect.

---
