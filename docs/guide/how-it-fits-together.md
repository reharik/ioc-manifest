# How it fits together

`ioc-manifest` is a build step, not a container. You write ordinary factories and classes; `ioc generate` reads them from source, works out what supplies what, checks that the picture holds together, and writes a manifest and a set of types that hand straight to [Awilix](https://github.com/jeffijoe/awilix). At runtime there is no scanning, no reflection and no registration code — only the registrations the generator already decided, as static imports a bundler can inline.

Two things follow from that, and most of the design is downstream of them. **Everything is declared at the site and read syntactically** — whether something registers, what contract it supplies, which of its dependencies is which — so the answer to any "is this registered, and as what?" is in the declaration you are looking at, not in a type-system inference several files away. And **`generate` is the verb that enforces**: it is the run that decides, and a run that cannot describe your sources coherently writes nothing at all.

The rest of this page is the pipeline in order. Each stage links to the chapter that owns it.

## 1. You write factories and classes

A **registration unit** is one thing the container knows how to build, and there are two kinds. A factory is an exported function whose name starts with `build`, whose return annotation names its contract, and whose first parameter is a named deps type. A class is an exported class with an `implements` clause, which is both its trigger and its contract site.

```ts
export const buildS3MediaStorage = ({ logger }: S3MediaStorageDeps): MediaStorage => ({ … });

export class S3MediaStorage implements MediaStorage { … }
```

Both register as `s3MediaStorage` supplying `MediaStorage`. Neither trigger is inferred from shape: a function that happens to return a `MediaStorage` but is not named `build*` is ordinary code.

→ [How conventions work](/concepts/conventions#the-two-registration-units) · [Class registration](/concepts/classes)

## 2. `ioc generate` discovers them

Discovery scans the directories your `ioc.config.ts` points at, subject to `includes` and `excludes`, and reports the outcome of every export it saw — discovered, near-miss with a reason, or not a candidate. Along the way it reads two nominal relationships off your contract types: **group membership** (the contract declares heritage to a group's base type) and **lifetime markers** (the contract declares heritage to a marker interface you mapped to a lifetime).

Nominal means declared heritage — `extends`, an intersection, or a plain alias — never structural similarity. `ioc inspect --discovery` is the report, and it is the tool for every "why isn't this registered?".

→ [`discovery` config](/config/reference#discovery) · [Groups](/concepts/groups) · [Lifetimes](/concepts/lifetimes) · [CLI](/reference/cli)

## 3. Contracts get keys, and one of them is the slot

Each implementation claims its own **registration key** — the camel-cased implementation name. Each ungrouped contract additionally claims a **contract slot key** — the camel-cased contract name — which resolves to whichever implementation is *elected* as that contract's default. The election is decided by config or by convention, and the slot follows it: change the election and every consumer naming the slot re-points, with no source edit.

A contract that elects no default has no slot key. A grouped contract has none categorically — [grouped means group-only](/concepts/groups#grouped-means-group-only). A scope-rooted contract has none either; it is opener-only.

→ [Registration keys](/concepts/conventions#registration-keys) · [Default selection](/concepts/conventions#default-implementation-selection) · [Contract slot keys](/concepts/conventions#contract-slot-keys)

## 4. Every dependency declares which of five things it is

A deps property is exactly one of five things, and which one is written down at the site:

| written | means |
| --- | --- |
| contract key — `mediaStorage: MediaStorage` | the contract's **elected default**, whichever implementation that is |
| `Named<T>` implementation key — `s3MediaStorage: Named<MediaStorage>` | **that specific implementation**, pinned; does not follow the election |
| group root key — `mediaStorages: MediaStorages` | the whole group |
| scope-root opener key — `openRequestScope: OpenRequestScope` | the opener for that boundary |
| anything else | an **external**: the composing app supplies it |

The first two both name the contract type, so before `Named<T>` they were spelled identically and differed only by facts invisible at the site. Now the difference is written. A property that names an implementation key without saying so is a hard error naming both legal spellings, and so is `Named<…>` anywhere it does not belong.

The chapter that articulates this rule — and that every diagnostic in the family links to — is [Demanding a dependency](/concepts/conventions#demanding-a-dependency-the-five-things-a-deps-property-can-be).

## 5. Generation writes — or refuses to

A successful run writes `ioc-manifest.ts` (the registration data) and `ioc-registry.types.ts` (the typed `IocGeneratedCradle`, the `IocExternals` this package expects from outside, and a named alias per group). In app mode it also writes `ioc-composed.ts` and runs the **full composition suite** before writing anything: externals satisfaction with real type comparison, registry integrity, cross-manifest key and group consistency, composed default ambiguity, app-config sanity. `ioc validate` runs that same suite, from the same module, over committed artifacts instead of pending ones.

A failing run writes **nothing**. One aggregated report names every offender — never first-failure-wins — and the files in your generated directory stay exactly as the last successful run left them. Because that is a trap for the next reader, a failing run leaves a marker beside the generated directory, and `validate`, `inspect` and `explain` banner their output while it is there.

A run that SUCCEEDS leaves a record too — a fingerprint of the sources it read — so the same three verbs can tell you when a package's artifacts may have fallen behind its sources without anything having failed. That is the ordering mistake everyone makes in a monorepo: edit the library, regenerate the app, forget the library.

→ [What gets generated](/guide/what-gets-generated) · [The staleness banner](/reference/cli#two-worlds-the-staleness-banner) · [Artifacts that may predate their sources](/reference/cli#the-other-half-artifacts-that-may-predate-their-sources) · [The composition suite](/reference/cli#ioc-generate-in-app-mode-the-composition-suite)

## 6. Packages compose

Each package generates in **library mode**, scanning only its own source. What it supplies is its `IocGeneratedCradle`; what it needs from outside is its `IocExternals` — a machine-readable promise to whichever app composes it later. An **app-mode** package names the packages it composes, and its generation is the first run that can say whether those promises are kept.

Composition is set-like: order never matters, and a conflict is an error with a named resolution, never a silent override.

→ [Cross-package composition](/monorepo/composition)

## 7. Runtime: bootstrap, scope roots, openers

Bootstrap is four lines: create an Awilix container typed by the generated cradle, hand `registerIocFromManifest` an array of manifests, resolve.

Some values are per-call rather than per-container — a request's viewer, a request's unit of work. A factory annotated `ScopeRoot<TContract, TLateBound>` declares that boundary, and generation emits an **opener** into the cradle: a plain function taking exactly the declared late-bound values, which opens a child scope, registers them onto it, and resolves the unit there. The late-bound set is declared and never inferred, and generation verifies the declaration against the actual resolution subtree — including across composed packages — reporting keys that are missing, mistyped, or declared and unused.

→ [Quick start](/guide/quick-start) · [Scope roots](/concepts/scope-roots)

## Where to go next

- **[Quick start](/guide/quick-start)** — a working single package, start to finish.
- **[Adopting on an existing codebase](/guide/adopting)** — what a red first run is telling you, and how to read it.
- **[Error handling](/reference/errors)** — the three registers every diagnostic is written in, and the code tables.
