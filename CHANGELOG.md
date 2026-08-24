# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - Unreleased

The first release written for someone **adopting** the tool rather than upgrading it, so this entry
says what the tool *is*, and the per-version history below says how it got here. Most of this work
was recorded during development under the `[3.0.0] - Unreleased` heading immediately following;
3.0.0 never shipped, and everything under it ships here. Those entries are kept as written.

**What it is.** A build step over your TypeScript sources. `ioc generate` discovers registration
units, resolves what supplies what, verifies that the resulting picture holds together, and emits a
manifest and a typed cradle that hand straight to Awilix. Nothing scans at runtime; the output is
plain TypeScript with static imports, and it is the registration code you would otherwise have
written by hand.

**Everything is declared at the site and read syntactically.** Whether something registers (a
`build` prefix, an `implements` clause), what contract it supplies (the name written at the contract
site, resolved to the declaration it names), and which of its dependencies is which — all of it is
answerable by reading one declaration. The checker is used to locate declarations and never to
normalize types, so identity is the pair (declaration file, declared name) and what you wrote is
what is registered.

**The demand model is the centrepiece.** A deps property is exactly one of five things, and which
one is written down:

| written | means |
| --- | --- |
| contract key — `mediaStorage: MediaStorage` | the contract's **elected default**, whichever implementation that is |
| `Named<T>` implementation key — `s3MediaStorage: Named<MediaStorage>` | **that specific implementation**; does not follow the election |
| group root key — `mediaStorages: MediaStorages` | the whole group |
| scope-root opener key — `openRequestScope: OpenRequestScope` | the opener for that boundary |
| anything else | an **external**: the composing app supplies it |

The first two both name the contract type. Before `Named<T>` they were spelled identically and
differed only by facts invisible at the site; a bare implementation-key demand is now a hard error
naming both legal spellings, and `Named<…>` on a contract key, group key, opener key or unregistered
name is a hard error too. `Named<T>` **is** `T` — transparent to TypeScript, recognized
syntactically off the written annotation, and never seen by emission.

**Grouped means group-only, and lifetime belongs to the base.** A contract in a group is consumed
through the group and through nothing else: no contract key (categorically, not merely unelected),
and no individual cradle keys for its implementations. A record group exposes each member as a
property keyed by the member's contract-derived name; a collection group's members are anonymous by
declaration. Membership is nominal — declared heritage to the base, never structural similarity —
and read from composed manifests as well as from local config, so a demand in an app for a library's
grouped member lands on the group law rather than on spelling advice. Because the family is handed
out interchangeably, the family ranks one lifetime and the base is the only place it may be
declared; a member's own marker or per-implementation `lifetime` override is refused, not outranked.

**Contract slots.** Every ungrouped contract that elects a default claims one cradle key beyond its
implementations' own — the camel-cased contract name, or a configured `$contract.accessKey` — typed
as the *contract*, because it means "whichever implementation is elected". It lives in the emitted
cradle, in the supply set the demand/supply pass and `ioc validate` read, and in the scope-root
subtree walk, all four deriving it through one function. No election, no key. A registration may
occupy the slot key only if it is the electee.

**Scope roots.** A factory returning `ScopeRoot<TContract, TLateBound>` declares a request- or
work-scoped boundary: the late-bound set is *declared* and never inferred, and the second argument
may be omitted to declare the empty set. Generation emits one typed **opener** per variant into the
cradle — a plain function taking exactly those values, which opens a child scope, registers them on
it, resolves the unit there, and returns it with an async disposer. No `AwilixContainer` appears in
its signature, so it is legal in a deps position. Verification is per variant and walks the real
resolution subtree, across composed packages where their manifests carry dependency keys and saying
so out loud where they do not: missing keys fail, type mismatches fail, declared-and-unused warns.
A scope-rooted contract is opener-only.

**`generate` is the enforcing verb.** Everything gen can know, gen enforces; `validate` exists to
run the same checks without regenerating. In app mode, generation runs the full composition suite —
externals with real type comparison, the registry-integrity gate, cross-manifest key and group
consistency, composed default ambiguity, schema versions, app-config sanity — after every emission
input is resolved and before anything is written. Both verbs build one program: your
`tsconfig.json`, your full source set, resolution as your own `tsc` performs it. A failing run
aggregates every offender into one report and writes **nothing**, so nothing broken lands on disk —
and because that leaves the previous run's artifacts in place, a failed attempt drops a marker that
makes `validate`, `inspect` and `explain` banner their output as stale until the next green run.

**Diagnostics are a surface, not a byproduct.** Every diagnostic renders in three registers: what
happened in a sentence, the mechanism (key, contract, file, line, types), and `→ docs: <url>`
resolving to the page that articulates the rule. The URLs come from one code→page map, and a test
resolves every one against the docs sources and against the rendered HTML, so a heading rename fails
the suite instead of 404ing a reader; a code with no page prints no arrow. Findings aggregate —
one run lists every offender, never first-failure-wins. `ioc inspect --discovery` reports every
scanned file and every export's outcome, with a footer counting the files config excluded; group
rejections collapse to a count unless they are informative. `ioc explain <key>` answers one key on
one screen: what it resolves to, its lifetime with a provenance chain, what it depends on, who
depends on it, and which scope-root subtrees reach it.

### If you ran a 4.0 rc

You are the only reader this section has, and the list is short.

- **Regenerate every package**, in lockstep. Manifests gained `dependencyKeys` and the
  `IOC_MANIFEST_FEATURES` export during the rcs; a composed manifest predating them is not wrong,
  but a scope-root subtree that runs through it is reported as a blind spot rather than walked.
- **`ioc validate --json` now emits an object, not a bare array.** `JSON.parse(out)` →
  `JSON.parse(out).issues`. See
  [Breaking in 4.0](https://reharik.github.io/ioc-manifest/reference/cli#breaking-in-4-0-ioc-validate-json-emits-an-object)
  for the envelope and the `staleness` field beside it. Per-issue field names are untouched.
- **`ScopeRoot<TContract>` is legal.** The one-argument form declares the empty late-bound set and
  emits a zero-parameter opener; it was a hard error in the earliest rc.
- **A previously-green app-mode `gen` may go red**, because generation now runs the composition
  suite it used to skip. Those are the errors `ioc validate` would have reported all along.

### Also in 4.0

Real work on this branch that the section below does not record.

- **Every generation leaves a record.** `.ioc-generation-state.json`, beside (never inside) the
  generated directory, records the outcome, a timestamp, the offender count on a failure, and a
  fingerprint of the inputs the run read. A FAILED record drives the staleness banner exactly as
  before: `validate`, `inspect` and `explain` banner to **stderr** while it is there, and carry the
  record as a `staleness` field under `--json`. A successful generation now **replaces** it with a
  success record in the same step that publishes the artifacts, rather than removing it — which is
  what makes the next entry possible. Recommended `.gitignore` entry:
  `**/.ioc-generation-state.json`.
- **Artifacts that may predate their sources are called out.** The staleness banner covers a
  generation that failed. The commoner mistake is the one where nothing fails: edit a library,
  forget the regenerate/rebuild ordering, and the app's `validate` reports the old world with total
  confidence. The record's fingerprint is a sha256 over the config source and
  `relativePath:sha256(content)` for every scanned file, so any byte changed, added or removed
  mismatches. `ioc validate` checks this package and every composed package; app-mode `ioc generate`
  checks the composed packages it reads; `inspect` and `explain` check this package. A mismatch is
  reported twice — a **banner** at the top of the output, and an inline `note:` on every finding
  that resolves through the package, which is the one the reader who skims the banner still meets.
  It never changes an exit code: `validate`'s job is checking committed artifacts, and the signal is
  a heuristic. When both a dependency and this app are behind, the banner names the dependency
  order. A package with **no** record gets one quiet advisory line, not the banner.

  The fingerprint stops at the scan set: a type imported from outside `discovery.scanDirs` can
  change generation's output without moving it, which is why the wording is always "may predate" and
  never a claim of proof. Cost is a fraction of a millisecond for a small package, and about 19 ms over a 480-file, 2.4 MB tree.
- **`ioc validate --json` emits `{ issues, staleness?, freshness? }`.** The envelope break is
  `issues` (see above); `freshness` is an added array, one entry per package judged, carrying
  `name`, `outcome`, `generatedAt` and `currentMatches` — the last **omitted rather than `false`**
  when nothing could be concluded. Tainted issues gain `possiblyStale: true`. No field was renamed.
- **The discovery footer counts config-excluded files.** An excluded file never enters the scan set,
  so nothing emits a skip row for it — the count is the only heartbeat it has, and `--verbose` and
  `--json` name the files. This is what makes an over-broad `excludes` glob findable at all.
- **Emission verifies its own import closure.** Named contracts are emitted **by reference**, and
  every printed name must be bound by an emitted import that its module actually exports. When it
  is not, generation hard-errors naming the contract, the position and the offending names, and
  writes nothing, rather than shipping a registry file the consumer cannot compile.
- **`registry-integrity` gates the type comparisons.** If a generated registry-types file does not
  compile, the suite reports that and **skips** the comparisons that read types out of it, instead
  of adjudicating them against error types (which pass unconditionally). Skipped comparisons are
  listed as skipped and never read as coverage.
- **Manifests carry per-unit `dependencyKeys`**, plus a sibling `IOC_MANIFEST_FEATURES` export so
  absence is not ambiguous. A composing app's scope-root subtree walk crosses package boundaries on
  that field, and states the blind spot where a composed manifest predates it.
- **Composed group membership is read at demand time.** All four grouped-member spellings now reach
  a library's members through the composed manifests, instead of prescribing a forbidden `Named<T>`
  and drifting out as an external.
- **Opener types are sanctioned in deps positions**, by alias and by cradle index, with opener keys
  joining the known-key and supply universes.
- **An lbv key is excluded from `IocExternals` only when every demand of it sits inside a declaring
  variant's subtree.** A declaration speaks for its own subtree and nothing else, so a unit
  reachable from outside one keeps the key in externals — and the discovery report lists those units
  under **Shared scope-root units** rather than leaving the entry to be deduced.
- **`ioc inspect` in manifest mode parses the generated manifest** through the shared loader parser
  instead of importing it, and marks the contract default only where the election was contested.
- **Group members resolve lazily, so a member can reach its sibling.** Group values were built
  eagerly — resolving a group constructed every member of it — which meant the one road grouped ⇒
  group-only leaves open was impassable: a member naming the group named something that was
  mid-construction *because of that member*, and Awilix reported a cycle for a graph that has none.
  Member slots are now memoized getters over the cradle captured at group construction. Resolving a
  group resolves no members; a member resolves the first time it is read and stays that instance for
  that group value; per-scope identity is unchanged, and a member read out of a group is the same
  object the cradle hands out for its key. Both kinds get it: a collection group's value stays a real
  array (`Array.isArray`, `length`, indexing, spread) whose elements are accessor properties, so a
  member that holds its own family and iterates it at call time works the same way. What still fails
  is a genuine cycle — a unit reading a member property while it is itself under construction — and
  it now surfaces with the `(group)` hop in the chain plus a note naming the read and the fix
  (read members at call time, not at the top level of a factory body). Enumerating a group value
  (`{ ...group }`, `Object.values`, spreading a collection) reads every slot and resolves every
  member; hold the group and read what you need. `console.log`/`util.inspect` is unaffected — an
  unread slot renders as `[Getter]`.
- **The runtime is strict by default.** `registerIocFromManifest` now enables Awilix **strict mode**
  on the container it is given, with an explicit opt-out:
  `registerIocFromManifest(container, manifests, overrides, { strict: false })`. Strict refuses to
  register a singleton on a scoped container, resolves singletons against the root container, and
  throws at first resolve when a longer-lived unit is handed a shorter-lived dependency instead of
  quietly freezing the first instance. The leak error arrives normalized as an
  `IocResolutionError` with the usual manifest-aware chain. **Behaviour change worth reading:** our
  static model ranks `singleton → transient` and `scoped → transient` as WARNINGS, and strict errors
  on them — so an edge generation only warned about now fails at first resolve. The warning text
  says so where it fires, and states the other half: `allowLifetimeInversion` suppresses the static
  report ONLY and is not a runtime exemption; if you suppress, fix the edge or turn strict off and
  own the tolerance. Two boundaries: strict backstops DIRECT edges only — a `consumer → group →
  member` edge is invisible to it, because lazy member slots resolve outside any enclosing
  `resolve()`, so the generation-time check through the group hop is the sole guard there; and
  contract default slots, group roots and scope-root openers are marked leak-safe, since their
  transient registration is a detail of how they are wired rather than a claim about how long their
  values live. Requires **awilix 13** (`^13.0.5`), up from `^12.0.5`.
- **Docs.** [How it fits together](https://reharik.github.io/ioc-manifest/guide/how-it-fits-together)
  is the front door; [Adopting on an existing
  codebase](https://reharik.github.io/ioc-manifest/guide/adopting) is the field guide for pointing
  this at code that already exists.

## [3.0.0] - Unreleased

The breaking release. Two design commitments that generated most of the library's post-1.0 bug
history are retired: contracts inferred from return-type symbols, and generated types consumed
back through TypeScript's own resolution. In their place, contract identity is **declared at the
site and read syntactically**, and every route from your source into the generated file is
enumerated and either resolved or rejected. Class registration units ride along, because a class's
`implements` clause is the same thing a factory's return annotation is — a declared contract site.

Most of what follows is a consequence of those two changes rather than a separate feature.

### Migrating from v2

In order. Each item names the error you get if you skip it.

1. **Regenerate every package with v3, before anything else.** Schema v3 refuses v2 manifests, as
   every schema bump has.

   > `[ioc] Manifest schema version mismatch. Runtime expects: 3 / Got: 2 from manifest at index 0`

2. **Add an explicit return type annotation to every `build*` export.** One aggregated error lists
   every offender by file and export name — that list is your worklist, and it is the fastest way
   to enumerate the work. `ioc inspect --discovery` reports the same set under
   `missing_return_type_annotation`.

   > `[ioc] 12 factory export(s) have missing or invalid return type annotations. v3 requires every factory to declare an explicit return type annotation naming its contract:`
   > `  - src/services/buildUserService.ts export "buildUserService": missing return type annotation — add an explicit return type naming the contract`

3. **Name any inline-object or anonymous-union annotation.** Same aggregated error, with per-offender
   guidance to declare an `interface` or `type` alias and annotate with it.

   > `  - src/tasks/buildTask.ts export "buildTask": anonymous union annotation — name the union with a type alias (e.g. \`type Task = EmailTask | SmsTask\`) and annotate the factory with the alias`

4. **Rename contracts whose declared name collides with another declaration.** Identity is now the
   pair (declaration file, declared name), so two declarations sharing a name are two contracts and
   no longer silently merge under one manifest key.

   > `[ioc] Contract name collision: the same contract name is declared in multiple files. Contracts are identified by (declaration file, name); two different declarations cannot share one manifest key. Rename one of the types:`

5. **Update `groupBaseTypeAliases` entries to the new package-relative `baseTypeId` form.** The
   composition error prints the exact values to paste.

   > `[group-base-type] Group "discountStrategies" has conflicting base type identifiers across manifests`

6. **Replace rejected generated-type reference forms.** Thirteen forms that previously fell through
   to type resolution are now hard errors; each names the file, line, offending text, and its
   supported replacement. The full table is in the docs under
   [Consuming generated types](https://reharik.github.io/ioc-manifest/reference/generated-types).

   > `[ioc] src/services/deps.ts:4 applies \`keyof\` to a generated registry type: \`keyof IocGeneratedCradle\`. \`keyof\` bakes a snapshot of the PREVIOUS cradle's keys into the new output, so the key set silently lags a generation behind. Index the keys you need explicitly (\`IocGeneratedCradle["albumRepository"]\`), or declare the union yourself.`

7. **Check the keys of any factory whose export name has consecutive capitals after the prefix.**
   This is the one migration item with **no dedicated error**, so it is worth a grep: see the
   camelCase entry under **Changed** for what changes and how it surfaces.

8. **Declare every demand that names an implementation registration key.** One aggregated error
   lists every offending deps property with the two legal spellings for its key — that list is your
   worklist. Demands written against a contract key, a group key or an opener key are untouched.

   > `[ioc] 3 deps properties do not name one of the five things a dependency can be. A deps property names either a contract key (the contract's elected default), an implementation registration key marked \`Named<TContract>\`, a group root key, a scope-root opener key, or an external:`
   > `  - [named-marker-required] Class "ArchiveStorage" at ArchiveStorage.ts:18 property "localStorage" is the registration key of implementation "localStorage" (contract "Storage", in this package), demanded without saying so. For the elected default, demand the contract key \`storage: Storage\`; for this specific implementation, write \`localStorage: Named<Storage>\`.`

9. **Decide, per contract, whether it is a family or a singular.** Grouped contracts lose their
   contract key and their member keys, so a contract that is both grouped and consumed individually
   no longer compiles. The same aggregated error lists every offending demand under
   `[grouped-member-demand]`. Either take the contract out of the group, or move every consumer onto
   the group key.

10. **Move any grouped member's lifetime declaration onto the group base.** `[group-lifetime-on-member]`
    lists members whose contract carries a marker the base does not; `[group-lifetime-config-override]`
    lists per-implementation `lifetime` overrides on grouped members.

Nothing else is required. In particular, existing `interface Foo extends Base {}` contracts keep
working unchanged — see the note under **Fixed**.

### Added

**`ioc explain <key>` — one cradle key, one screen.** A read-only command that answers the question
a developer actually arrives with: what does this key resolve to, how long does it live and who
decided that, what does it pull in, and who breaks if it changes. Every fact was already somewhere
in the manifest or the scan; what is new is the join.

```
orderWriteService → registration of OrderWriteService (orderWriteService)
  declared in src/factories/buildOrderWriteService.ts#buildOrderWriteService

Lifetime: scoped ← group-base marker on WriteServiceBase (RequestScopeLifeCycle) ← member of group "writeServices"

Depends on:
  uow  scoped  registration of UnitOfWork
  idGenerator  transient  registration of IdGenerator
      ![lifetime-inversion] a scoped consumer holding a transient dependency keeps the first instance it was given
      → docs: https://reharik.github.io/ioc-manifest/concepts/lifetimes#the-floor-rule

Demanded by:
  auditRunner (src/factories/buildAuditRunner.ts)  via group:writeServices

Reached from scope roots:
  ⬢ IRouter variant: authRouter  opener: openAuthRouterScope
```

Two modes, the same two sources `inspect` uses: the generated manifest by default, a fresh scan
with `--discovery`. Lifetime provenance and scope-root subtree reach exist only in the scan, and
manifest mode says so rather than guessing. `--json` carries the same record. Read-only, and it
parses the manifest rather than importing it.

**Docs pointers on diagnostics.** Every diagnostic now renders in three registers — a
plain-language sentence, the mechanism (key, contract, file and line), and `→ docs: <url>`. URLs
come from one map of diagnostic code → page, never from message text, and a test resolves every one
of them against the docs sources and against the rendered HTML after `docs:build`: a heading rename
that breaks a pointer fails the suite instead of 404ing a reader. A code with no page yet prints no
arrow.

**A lifetimes chapter written from real incidents.** [The floor rule](https://reharik.github.io/ioc-manifest/concepts/lifetimes#the-floor-rule)
(a unit lives at most as long as its shortest-lived dependency, which is why repositories are
scoped), [the captive dependency](https://reharik.github.io/ioc-manifest/concepts/lifetimes#the-captive-dependency)
(the singleton that froze a per-request unit of work — the incident the inversion check was written
for), [the ungrouping cliff](https://reharik.github.io/ioc-manifest/concepts/lifetimes#the-ungrouping-cliff)
(a member leaves a group, silently falls to the default lifetime, and inversion errors are the net),
and the [provenance vocabulary](https://reharik.github.io/ioc-manifest/concepts/lifetimes#lifetime-provenance).
Scope roots also get a [user-facing chapter](https://reharik.github.io/ioc-manifest/concepts/scope-roots)
with the verification codes and a troubleshooting section.

**Class-based registration units.** An exported class with an `implements` clause is a
registration unit. The `implements` clause is its contract site — the same declared, syntactic
position a factory's return type annotation occupies, read by the same resolver, producing the
same (declaration file, declared name) identity. One identity rule, two unit kinds.

```ts
// Factory unit — the contract is the return type annotation.
import type { MediaStorage } from "./contracts.js";

type S3MediaStorageDeps = { logger: Logger };

export const buildS3MediaStorage = ({ logger }: S3MediaStorageDeps): MediaStorage => ({
  label: "s3",
  put: async (key) => logger.log(`stored ${key}`),
});

// Class unit — the contract is the `implements` clause. Registration key `s3MediaStorage`,
// dependencies from the constructor's single destructured object parameter.
import type { MediaStorage } from "./contracts.js";

type S3MediaStorageDeps = { logger: Logger };

export class S3MediaStorage implements MediaStorage {
  label = "s3";
  readonly #logger: Logger;

  constructor({ logger }: S3MediaStorageDeps) {
    this.#logger = logger;
  }

  async put(key: string): Promise<void> {
    this.#logger.log(`stored ${key}`);
  }
}
```

Everything downstream is unchanged: registration keys, default election, group and marker
membership, demand analysis, lifetime checks, composition. A class and a factory implementing
the same contract compete for the default exactly as two factories do, and a class joins a
group on the same assignability rule.

Specifics:

- **Trigger.** An exported class with `implements` in a scanned directory. A class without
  `implements` is ordinary code — ignored silently, never reported as a failed registration.
- **Registration key.** camelCase of the class name, using Awilix's own
  `formatName: "camelCase"` algorithm, so a codebase migrating off `loadModules` keeps its
  container keys. `S3MediaStorage` → `s3MediaStorage`; `APIClient` → `apiClient` (the acronym
  run splits as `API|Client`). All existing key policy — config `name` overrides,
  `$contract.accessKey`, divergent-name warnings — applies unchanged.
- **Dependencies.** The constructor's single destructured object parameter, analyzed by the
  same path as a factory's deps parameter (named local deps type required). No constructor or a
  zero-parameter constructor means no dependencies. Several parameters, a rest parameter, a
  parameter property, or a primitive/array/function parameter type is a hard error explaining
  that PROXY-mode injection needs one object parameter — CLASSIC-mode parameter-name injection
  is out of scope.
- **Lifetimes.** Markers resolve from the `implements` contract exactly as from a return
  annotation.
- **Several `implements` entries** is a hard error naming the class and every contract,
  resolvable with the new `classes` config surface:
  `classes: { DualUnit: { contract: "Auditor" } }`.
- **Registration mechanism.** A class unit registers as `asFunction(cradle => new Ctor(cradle))`.
  Under PROXY injection this is behaviorally equivalent to `asClass(Ctor, { injectionMode: PROXY })`
  — that is exactly what `asClass` does — but routing it through the shared factory wrapper is what
  gives class units the same resolution diagnostics as factories. `asClass` exposes no error hook,
  so a class registered through it would resolve outside the instrumented path: no manifest-aware
  frames in the resolution chain, and a raw `AwilixResolutionError` escaping a root resolve instead
  of an `IocResolutionError`.
- **`loadModules` migration warning.** When a class's file name would have produced a different
  key under Awilix `loadModules` (which keys on the file name, not the class name), generation
  says so — `storage.ts` exporting `S3MediaStorage` registers as `s3MediaStorage`, not `storage`.
  Kebab and snake file names that camelCase to the same key are silent. Suppress per class with
  `classes: { S3MediaStorage: { allowDivergentFileName: true } }`.
- Classes that match the trigger but cannot be registered get categorized skip reasons in the
  same aggregated reporting as factories and appear in `ioc inspect --discovery`.

**Inherited-contract diagnostic.** A concrete exported class that extends a base carrying an
`implements` clause, but declares none itself, is not registered — and is now reported rather than
dropped in silence:

```
[ioc] 1 concrete class(es) inherit a contract but declare no `implements`, so they were NOT registered:
  - src/storage/ArchiveStorage.ts class "ArchiveStorage" extends StorageBase, which declares
    `implements MediaStorage`. Add `implements MediaStorage` to ArchiveStorage to register it.
```

Discovery walks the `extends` chain syntactically to the nearest `implements`-bearing ancestor,
using the same import-following machinery contract-site resolution uses. **That walk is
diagnostics-only and never registers anything.** Inheriting a contract does not inherit
registration, by decision: the trigger stays local and explicit so that reading a class tells you
whether it registers, without following a heritage chain across files. The diagnostic is a warning,
never fatal — deliberately unregistered subclasses are legitimate — and appears in
`ioc inspect --discovery` under `class_inherited_contract_not_declared`.

**Scope-root registration units and their emitted openers.** A factory whose return annotation is
`ScopeRoot<TContract, TLbv>` declares a request- or work-scoped boundary: `TContract` is what is
resolved from the scope once it is open, `TLbv` is the developer-declared set of late-bound values
that enter at it. The lbv set is declared and never derived — the generator verifies the
declaration against the resolution subtree and reports disagreement, it does not synthesize one.

```ts
import type { ScopeRoot } from "ioc-manifest";

export const buildAuthRouter = (
  deps: AuthRouterDeps,
): ScopeRoot<IRouter, { viewerId: ViewerId; uow: UnitOfWork }> => makeRouter(deps);
```

Omitting the second type argument (`ScopeRoot<IRouter>`) declares a boundary with no late-bound
values — the same declaration as writing `Record<string, never>`, and its opener takes no argument.

Generation emits one **opener** per variant — registered in the cradle under its own key,
injectable as an ordinary dependency, typed from the declared lbv:

```ts
const { authRouter, dispose } = openAuthRouterScope({ viewerId, uow });
try {
  await authRouter.handle(req);
} finally {
  await dispose();
}
```

The opener creates a child scope from the scope that resolved it, registers each late-bound value
and the variant factory onto it, resolves the variant eagerly, and returns it with an async
disposer (double-dispose is a no-op). No `AwilixContainer` appears in its parameter or return, so
it is legal in a deps position — which is what retires hand-authored `AwilixContainer<RequestScope>`
view types. Variants of one root contract claim no cradle key and elect no default: they are
different scopes, not competing implementations. A contract that is both scope-rooted and
ordinarily registered is a hard error; opener keys join the same global key-uniqueness namespace as
registration and group-root keys.

A key a variant declares as late-bound is excluded from `IocExternals` only when every demand of it
in the package sits inside the subtree of a variant that declares it. A declaration speaks for the
declaring variant's subtree and for nothing else, so any demand outside one — an ordinary factory, a
class, a variant that demands the key without declaring it — keeps the key in `IocExternals` and the
app is still asked for the container constant that consumer will resolve. Shadowing that constant
per-open from inside a scope stays supported precisely because the base ask survives it.
`config.scopeProvided` outranks all of it, and survives for hand-opened scopes with no `ScopeRoot`
declaration to speak for them.

Schema note: `scopeRoots` ships as an optional field within schema v3 rather than as a version bump.
A runtime predating opener emission that composes a manifest carrying `scopeRoots` fails loudly (the
field is rejected as a malformed group root); this is accepted because a lockstep monorepo never
mixes tool versions across generation and composition. Publishing scope-rooted packages for
consumption by independently versioned runtimes would need this revisited.

**Contract slot keys in the static layers.** A contract with an elected default answers to its
contract key — the camel-cased contract name, or a configured `$contract.accessKey`. Runtime always
registered it (`aliasTo(elected)`), but the demand/supply pass did not know it existed: a factory
that demanded it shadowed the emitted cradle property with a demand entry, was classified external,
and appeared in `IocExternals`, asking the composing app to supply a key the package supplies
itself. The key now joins the emitted cradle, the supply set the demand/supply pass and
`ioc validate` read, and the scope-root subtree walk — all four deriving it through one function, so
they cannot drift apart.

The slot key is emitted as the CONTRACT, by reference, not as the elected implementation's
structural supply type. It means "whichever implementation is elected", and printing the elected
one's type would stop being right the moment the election moved.

```ts
// generated/ioc-registry.types.ts
export interface IocGeneratedCradle {
  authMiddleware: AuthMiddleware;        // the slot: follows the election
  optionalAuthMiddleware: AuthMiddleware; // the elected implementation
  strictAuthMiddleware: AuthMiddleware;   // the other one
}
```

**No election, no key.** The slot exists if and only if the contract elects a default. A group base
with no explicit `default: true` has none, and a demand for its name is an ordinary unsatisfied
demand reaching `IocExternals` — consistent with generation's existing hard error for an unelectable
multi-implementation contract and with validate's `default-ambiguity`. Scope-rooted contracts have
none either: they claim no registration key and reach no registration plan, so opener-only stands.
Slot keys join global key-uniqueness through the machinery that already owned it.

**`Named<T>`: declaring a demand for one specific implementation.**

```ts
import type { Named } from "ioc-manifest";

type RequestPipelineDeps = {
  // The contract key: whichever implementation ioc.config elects.
  authMiddleware: AuthMiddleware;
  // That implementation, declared as one. Does not follow the election.
  strictAuthMiddleware: Named<AuthMiddleware>;
};
```

`Named<T>` **is** `T` — transparent to TypeScript, so it changes nothing about assignability,
inference, or what the factory receives. The generator recognizes it syntactically off the written
annotation, by written name and with no checker involvement, exactly as it recognizes `Promise<T>`
and `ScopeRoot<TContract, TLbv>`; a locally-declared `Named` shadows it, which is the same trade.

It verifies that the property's name is an implementation registration key — local or composed (a
composed manifest carries each unit's `contractName`) — whose declared contract is **exactly** `T`.
Identity, not assignability: a supertype the implementation happens to satisfy is a different
statement. The marker where it does not belong is a hard error with its own code — on a contract
slot key, a group root key, an opener key, or a name nothing registers — and wrong arity follows the
`scope_root_wrong_arity` precedent. The full code table is in the docs under
[Error handling](https://reharik.github.io/ioc-manifest/reference/errors).

Emission never sees the marker: the deps echo and every emitted position carry the contract, by
reference.

**Group lifetime is declared on the base.** A group is a family whose members are handed out
interchangeably, so the family ranks one lifetime and the base is where it is declared. Every member
inherits it and reports provenance `group-base-marker` — distinguished from an ordinary
`lifetime-marker` because the declaration sits somewhere the member does not control, which is what
a reader chasing an unexpected lifetime needs to be told. `ioc inspect --discovery` prints
`scoped (group-base-marker)`.

```ts
// The base, and the only place this family's lifetime may be declared.
export interface LoggingService extends IScoped {
  readonly id: string;
  ping: () => string;
}
```

Lifetime-inversion checking sees it through the group **hop**: a root-resolved singleton consuming a
scoped group is reported exactly as one consuming a scoped member, `via group '<key>'`. Suppression
is unchanged and belongs on the consuming registration.

### BREAKING

**BREAKING: a registration occupying its contract's slot key must be the electee.** A factory named
after its contract registers under the contract's slot key (`buildMediaStorage` → `mediaStorage`,
for `MediaStorage`), and Awilix holds one registration per name — so that registration owned the
key outright. When a *different* implementation was elected, the key handed out the occupant while
the election named someone else, silently, and the contract key stopped following the election.
That is now a hard error, offender-bucketed, at `ioc generate` and as `[slot-occupancy]` in
`ioc validate`.

The occupant being the electee is untouched: the slot and the key coinciding by agreement is the
sanctioned single-name case, and a contract with one implementation named after it is its main
road. Grouped contracts have no slot to occupy, and scope-rooted contracts are opener-only.

**Migration.** The error names both exits, and which one is right depends on what you meant:

> `Implementation "mediaStorage" occupies contract "MediaStorage"'s slot key "mediaStorage" but is not the elected default ("s3MediaStorage" is). Rename the factory so the key stops shadowing the slot (qualify the export, "buildS3MediaStorage"-style, so it registers under a key of its own), or elect "mediaStorage" as the default for "MediaStorage".`

Renaming is usually what was meant — every consumer writing the contract key was already getting
the occupant rather than the election, so the rename is what makes the code do what it reads as.
Electing the occupant is right when the shadowing factory really is the default and the config
entry was the mistake.

**BREAKING: app-mode `ioc generate` runs the composition suite, and can now fail where it used to
pass.** When `composedManifests` is set, generation judges the composition it already performs:
externals satisfaction with type comparison, the `registry-integrity` gate, cross-manifest key and
group consistency, composed default ambiguity, schema versions, and app-config sanity. The suite
runs after every emission input is resolved and **before any file is written**; an error-severity
finding aborts the run with one aggregated report naming every offender, and no output lands on
disk. Warnings warn and the run continues, matching `ioc validate`'s severities exactly.

The principle: **everything gen can know, gen enforces; `validate` exists to run the same checks
without regenerating.** Generation already loaded composed manifests, emitted `ioc-composed.ts`,
walked composed subtrees and resolved composed opener and slot keys — it held every fact these
checks adjudicate, and did not adjudicate them. For the primary workflow, where generated output is
not checked in and `gen` runs on every change, `validate` structurally never ran, so the whole layer
was dead code in practice: `gen` was passing while validation had all manner of errors.

**Migration.** A previously-green `gen` may go red on your first v3 run. These are not new checks
and they are not new errors: they are the errors `ioc validate` would have shown you all along, now
reported by the verb you actually run. Read the aggregated report, fix what it names, or run
`ioc validate` for the same report without regenerating. There is no flag to suppress the suite —
`validate`-without-`gen` is the only alternate path.

> `[ioc] App-mode generation refused: the composed picture this run would emit does not hold together. 2 errors, 0 warnings:`
> `[externals] Unsatisfied: key "logger" demanded by @acme/lib-services`
> `No files were written. These are real composition errors — ioc validate has always reported them…`

**Library mode is unchanged.** No composition check runs there, and none is skipped: every check is
a relation *between* manifests, and a library has no composed set to relate to.

**BREAKING: a bare implementation-key demand is now an error.** A deps property whose name is an
implementation registration key — and which is not also a contract slot key, a group root key or an
opener key — must carry `Named<T>`.

```ts
// Before: legal, and it meant one of two things depending on facts invisible here.
type Deps = { strictAuthMiddleware: AuthMiddleware };

// After: say which.
type Deps = { authMiddleware: AuthMiddleware };          // the elected default
type Deps = { strictAuthMiddleware: Named<AuthMiddleware> }; // that implementation
```

The error names both spellings for your key, and aggregates — one run lists every offending
property with its unit, file, line and property name:

> `[ioc] 1 deps property does not declare which of the five things a dependency can be it is. …`
> `  - [named-marker-required] Class "ArchiveStorage" at ArchiveStorage.ts:18 property "localStorage" is the registration key of implementation "localStorage" (contract "Storage", in this package), demanded without saying so. For the elected default, demand the contract key \`storage: Storage\`; for this specific implementation, write \`localStorage: Named<Storage>\`.`

Two spellings are exempt, both because they already say which cradle key they name: a property whose
name is the contract slot key (that is the contract-key row of the model), and one typed through an
enumerated generated-reference form such as `IocGeneratedCradle["s3Storage"]`.

**BREAKING: grouped contracts are group-only.** A contract that is a member of a configured group is
consumed through the group and through nothing else — the symmetric twin of "scope-rooted ⇒
opener-only". It has **no contract key** (categorically, not merely unelected — a grouped contract
with one implementation is slotless too), and its implementations claim **no individual cradle
keys**: a record group already exposes every member as a property of the group value, and a
collection group's members are individually anonymous by declaration.

```ts
// All four spellings are the same mistake, and all four get the same guidance.
type Deps = { emailChannel: Named<EmailChannel> };        // the member's own contract
type Deps = { emailChannel: Named<NotificationChannel> }; // the family interface
type Deps = { emailChannel: EmailChannel };               // bare
type Deps = { notificationChannel: NotificationChannel }; // the contract key it does not have

// The one way in:
type Deps = { notificationChannels: NotificationChannels };
```

> `  - [grouped-member-demand] Factory "buildDispatcher" at dispatch.ts:9 property "emailChannel" carries \`Named<…>\`, but "emailChannel" is an implementation of "EmailStrategy", a member of group "notificationStrategies". A grouped contract is consumed through its group and through nothing else — it has no contract key and its implementations claim no individual cradle keys. Consume it through the group: \`notificationStrategies: NotificationStrategies\`, then \`notificationStrategies.emailStrategy\`. …`

Runtime keeps what the typed surface hides: member registration keys stay registered, because the
group resolver hands its members out by registration key. The contract-slot alias is not registered
at all — runtime mirrors generation, so nothing resolves under a name the emitted cradle omits.

Two checks are **vacated by construction** rather than answered differently. `ioc validate`'s
`default-ambiguity` skips grouped contracts: several implementations with no `default: true` is the
ordinary, correct shape of a group, and reporting it told developers to elect a default for a key no
consumer may name. And the per-implementation membership filter that dropped a non-default
implementation registered at the contract's default-slot key is retired — with no slot there is
nothing to duplicate, and dropping a member would produce a group that looks complete and is not.

**BREAKING: a grouped member may not declare its own lifetime.** A `lifetimeMarkers` interface on a
grouped member's contract that the base does not carry, or a per-implementation `lifetime` override
in `ioc.config` for a grouped member, is a hard error rather than a losing bid in a precedence
chain. The member is claiming authority over a property of the family it does not own.

> `  - [group-lifetime-on-member] Contract "RequestTracingLogger" (implemented in buildRequestTracingLogger.ts) declares lifetime marker "IScoped" (scoped), but it is a member of group "loggers": lifetime is a property of the group; declare the marker on the base "LoggingService" (member "RequestTracingLogger" may not carry its own).`

A member that redundantly restates the base's own marker is not an error — it is indistinguishable
from inheriting it, and the base owns the lifetime either way. Markers and groups stay orthogonal in
both directions: a `lifetimeMarkers` interface never induces group membership, and a group base
doubling as a lifetime carrier does not change membership, which remains the nominal-heritage walk
to `config.groups` base types.

The 2.x rule this replaces was **not** most-restrictive-member-wins — that never existed here. What
2.0.0 shipped was "group roots are transient wrappers; members keep their own lifetimes": no
aggregation at all, and a group could hand out a mixed-lifetime collection with nothing said about
it. The tombstone is in the design doc under §8.6.

**BREAKING: the divergent-name advisory is retired.** `ioc generate` no longer warns when a
single-implementation contract's registration key differs from its contract key. The advisory
existed because the two names were two names for one thing; they are not any more — the contract key
follows the election and `impl: Named<C>` does not — so a divergence between them is a distinction,
not a duplicate. `$contract.allowDivergentName` is still accepted by the config schema (existing
configs keep validating) and is now a no-op.

### Changed

**Group rejections collapse to a count unless they are informative.** The groups section listed
every considered-and-rejected contract, one line each — but membership is checked for every
contract against every group, so a real consumer package with 91 units and 7 groups rendered about
2,000 lines of the same stock sentence. A rejection now earns its own line only when it satisfies
the base's shape without declaring heritage, or the generated manifest on disk lists it as a member
(it is leaving the group in this run), or its reason is not the stock heritage one. Everything else
becomes `considered, rejected: 84 (nominal_heritage_not_declared) — use --contract <name> for a
specific verdict`. `--contract` is the drill-down, `--verbose` prints the whole wall, and `--json`
is unchanged — it carries every rejection, each labelled with the `informative` flag the human
screen acted on.

**Diagnostics render in three registers, with colour.** Multi-concept preambles state the rule in
plain language and name their enumerations rather than articulating them inline — the demand-model
error's five things are now a parenthetical of names with the articulation at the link. Per-offender
detail is untouched. Terminal output is coloured when stdout is a TTY, honours `NO_COLOR` and
`FORCE_COLOR`, and is byte-identical to the old plain text when disabled; severity is stated in
words as well as colour, and colour never reaches `--json`.

**`ioc validate --json` issues carry `docUrl`.** Added, not renamed; every other field is unchanged.

**Lifetime provenance renders only when it is informative.** A discovery row said
`singleton (default)` on most rows of most reports, which is what made the one row saying
`(group-base-marker)` stop standing out. `default` is now omitted.

**Contract identity is what you wrote at the contract site.** The checker no longer infers or
normalizes the contract: `Promise<T>` and parentheses are unwrapped syntactically, the remaining
annotation must be a single named type reference, and the contract is that reference's
declaration. Import aliases are followed, so `import { Foo as Bar }` annotated as `Bar` is the
contract `Foo`; type-level aliases are never followed. Canonical identity is the pair
(declaration file, declared name) — two different declarations sharing a name now fail generation
with an error naming both declaration sites instead of merging under one manifest key.

**Explicit return type annotations are now required.** A prefix-matched factory export without one
fails generation with a single aggregated error listing every offender. Inline object-literal
annotations and anonymous unions are also errors, with guidance to name the type.

Because identity is what was written, **plain type aliases and named union aliases are now
first-class contracts**:

```ts
// v2: a plain alias collapsed into its target, so a distinct contract required
// an empty interface extension.
export interface QueueTask extends WorkerTaskBase {}

// v3: the alias IS the contract — distinct from WorkerTaskBase, and still a member
// of WorkerTaskBase groups/markers via the alias-target heritage chain.
export type QueueTask = WorkerTaskBase;

export const buildQueueTask = (deps: QueueTaskDeps): QueueTask => ({ ... });
```

Group and lifetime-marker membership keep the nominal heritage walk (`extends` chains,
intersection members, import-alias following); the walk now enters at the annotation's resolved
declaration, and alias-target steps count as heritage — consistent with how `type Foo = Bar & Marker`
already behaved.

**BREAKING: one camelCase rule for every registration key.** Through v2, a factory's key came from
lowercasing exactly one character after the prefix strip, while class keys used the ported Awilix
`formatName: "camelCase"` algorithm. The two disagreed on any name with an acronym run, so the same
acronym reached the cradle under two spellings depending on which unit kind supplied it. v3 uses the
Awilix algorithm everywhere — factory keys, class keys, and contract access keys alike.

The rule: split into words on non-alphanumeric separators and on case transitions, treating an
acronym run as one word; lowercase the first word, capitalize later words with the rest lowercased.

```ts
// Factory export name, past the `build` prefix:
buildAPIClient;   // v2 → aPIClient     v3 → apiClient
buildHTTPSProxy;  // v2 → hTTPSProxy    v3 → httpsProxy
buildAlbumService; // v2 → albumService  v3 → albumService  (unchanged)
```

Only names with **consecutive capitals after the prefix** change; ordinary CamelCase names and
names with digits (`buildS3MediaStorage` → `s3MediaStorage`) are unaffected. The same applies to a
contract's access key, which had to move with it: a contract named `APIClient` whose access key
stayed `aPIClient` would never convention-match its own `apiClient` implementation, and would emit
two cradle spellings of one acronym.

To keep a v2 key exactly as it was, name it explicitly — `registrations[Contract][impl].name`
overrides the derived key and always has:

```ts
registrations: {
  ApiClient: {
    apiClient: { name: "aPIClient" },
  },
},
```

This is the one migration item with no dedicated error. It surfaces at compile time in any
composition setup — the changed key moves from `IocGeneratedCradle` into `IocExternals` for
consumers still demanding the old spelling, and the externals assertion fails — and at the first
resolve otherwise, as an `IocResolutionError`. Grepping for the old spelling is the quickest check.

**Manifest schema version 3.** Composition refuses a v2 manifest outright, as it always has across
versions — regenerate every package with the same ioc-manifest version.

Implementation metadata gains `kind: "class"`. It is emitted only for class units: absent
reads as `"factory"`, matching how every other conventional value in this metadata (`default`,
`accessKey`, `discoveredBy`) stays out of generated output rather than being restated on every
entry. Since schema v3 refuses v2 manifests there is no cross-version reader to consider, so
the choice is purely ergonomic, and the smaller diff wins.

`baseTypeId` — the opaque canonical identifier for a group's base type — is now
**package-relative** instead of an absolute path:

```ts
// v2 — machine-specific; two developers regenerating the same package got different bytes.
baseTypeId: "/home/alice/work/monorepo/packages/contracts/src/types/Storage.ts:Storage";

// v3 — `<packageName>/<path within that package>:<TypeName>`.
baseTypeId: "@acme/contracts/src/types/Storage.ts:Storage";
```

The package name comes from the nearest enclosing `package.json`; the path is POSIX-relative to
that manifest's directory. The value is identical on every machine and checkout, and stays
unambiguous between two packages that declare the same type name at the same inner path. This
is the main reason `groupBaseTypeAliases` existed: diamond hoisting used to change the absolute
path and so the id. `groupBaseTypeAliases` is unchanged and still needed where the same logical
type is reached through genuinely different package layouts (a workspace `src/Storage.ts` build
versus a published `dist/Storage.d.ts` one) — the escape hatch is narrower now, not gone.

**Regenerate after upgrading**: `baseTypeId` values change in every generated manifest that
declares a group, and any `groupBaseTypeAliases` entries must be updated to the new form (the
composition error prints the values to copy).

**Thirteen generated-reference forms now fail generation** wherever they appear in scanned source.
Each error names the file, the line, the offending form, and the supported replacement, and all
offenders in a run are aggregated into one error. The forms are: `keyof` on a generated type;
`typeof` on a generated binding; chained (`Cradle["a"]["b"]`), computed (`Cradle["a" | "b"]`) and
type-argument-bearing (`Cradle<T>["a"]`) indexed access; indexing anything other than
`IocGeneratedCradle`; `extends`/`implements` on a generated type; `import … = require(…)` /
`export =` / default imports of the generated file; and `/// <reference path=… />` directives
naming it.

The two that most often appear in real code:

```ts
// Rejected: `keyof` bakes a snapshot of the PREVIOUS cradle's keys into the new output.
import type { IocGeneratedCradle } from "./generated/ioc-registry.types.js";
export type CradleKey = keyof IocGeneratedCradle;

// Rejected: extending the cradle absorbs every member of the PREVIOUS registry into the
// deps type, so the whole stale registry is re-demanded on the next run.
interface UploadDeps extends IocGeneratedCradle {}

// Supported: demand the keys the factory actually needs.
type UploadDeps = { storage: IocGeneratedCradle["storage"] };
```

Separately, a generated type reaching a factory **deps type or return type** in any form other
than the two claimed ones is now rejected there, by a structural backstop that runs
immediately before demand analysis would hand the type to the checker. This covers shapes that
are legal elsewhere but not here — `{ cradle: IocGeneratedCradle }`,
`{ chans: ReadonlyArray<Channels> }`, `Pick<IocGeneratedCradle, "storage">`,
`type Deps = IocGeneratedCradle & { … }`. `ReadonlyArray<Channels>` and
`Pick<IocGeneratedCradle, …>` are the only two of these that used to produce output; both
produced it by reading the previous generated file. (A group alias is already the collection type —
`Channels` *is* `ReadonlyArray<Channel>` — so `ReadonlyArray<Channels>` was never right.)

Naming a generated type is unaffected — the documented composition-root pattern
(`createContainer<IocGeneratedCradle>()`) is still legal, because the name is only ever
printed back and never read into.

**The abstract-class warning is narrower.** `abstract class Base implements Contract` is the normal
base-class pattern, and warning on every occurrence trained people to ignore the warning. It now
fires only when the registration is genuinely missing — when no concrete class in scan range
declares `implements` for that contract. When a concrete subclass registers it, generation is
silent.

### Fixed

**`[externals] [externals]` on composition output.** The externals check embedded its own category
tag in each summary while the renderer prefixed the category too. The tag is now printed once, by
the renderer, from the issue's `category` — which also means `--json` summaries no longer repeat a
field they sit next to.

**Composition type comparisons no longer disagree with your own `tsc`.** `ioc validate` built a
program of its own: the generated registry-types files of several packages as root names, nothing
else — a shape no real build ever compiles. In a symlinked workspace (`node_modules/@scope/lib →
packages/lib`, which is every npm/pnpm/yarn workspace) that program admitted one physical file
TWICE: the composed registry file entered as a root under its `node_modules` path, while the app's
own sources reached the same package through module resolution, which TypeScript realpaths. Two
`SourceFile`s meant two copies of every declaration in that file, and a class with private or
protected members anywhere in the compared chain is not assignable to its own copy. The visible
symptom was `[externals]` type-incompatible errors on keys that `tsc --noEmit -p tsconfig.json`
accepted without complaint.

Both verbs now build ONE program: your `tsconfig.json`, your full source set rooted, resolution as
your own `tsc` performs it, with root names canonicalised so each physical file is admitted exactly
once. A guard hard-errors naming both paths if two `SourceFile`s ever share a real path again —
this class of defect produces confident, plausible, wrong verdicts, so it gets a check rather than
a comment. `ioc validate` may be marginally slower as a result; telling the truth is worth it.

**`[default-ambiguity]` now sees grouped MEMBERS through `ioc validate`, not just group base types.**
Validate parsed generated manifests with a second, lesser parser that recovered only
`registrationKey` from each group member and dropped its `contractName`. Grouped ⇒ group-only
therefore vacated ambiguity for the base type alone, and a grouped member with several
implementations and no `default: true` — the ordinary, correct shape of a group — was still
reported as ambiguous. There is one manifest parser now.

Every syntactic form by which scanned source can reach a type in the generated registry file
is now either resolved against the in-memory manifest or rejected with a pointed error. The
enumeration is explicit in the source (`generatedReferenceForms.ts`), and the detection logic
and the tests both key off it. The audit behind this found fifteen forms that reached
TypeScript's own type resolution instead — a silent-wrong-output bug rather than a crash,
because on a warm run the checker reads the *previous* generated file and bakes stale types
into the new one, while on a cold run the same reference resolves to `any`.

Two of the fifteen are now **resolved**, because they are reasonable ways to consume the
registry. A namespace import resolves exactly like a named one:

```ts
import type * as Ioc from "./generated/ioc-registry.types.js";

type UploadDeps = {
  storage: Ioc.IocGeneratedCradle["storage"]; // resolved (was: stale type / cold-start abort)
  channels: Ioc.Channels;                     // resolved (was: cold-start abort)
};
```

And a type alias standing between the deps property and the reference now resolves through
the intermediate module, not just within one file:

```ts
// deps-aliases.ts — this module, not the factory, imports the generated file
import type { Channels, IocGeneratedCradle } from "./generated/ioc-registry.types.js";
export type SharedChannels = Channels;
export type SharedStorage = IocGeneratedCradle["storage"];

// uploadService.ts
import type { SharedChannels, SharedStorage } from "./deps-aliases.js";
type UploadDeps = { storage: SharedStorage; channels: SharedChannels };
```

The other thirteen are rejected — see **Changed** above.

**The lint-autofix trap is gone.** Through v2, converting `interface Foo extends Base {}` to
`type Foo = Base` — which several lint autofixes do unprompted — silently broke discovery, because
a plain alias collapsed into its target. Both forms now denote the same contract, so the autofix is
a no-op on behavior. **Existing empty-extending-interface contracts keep working unchanged**; there
is nothing to migrate, and you may simplify them if you want to.

**Contract name collisions no longer merge silently.** Two same-named declarations in different
files used to land in one manifest entry, with whichever was discovered second overwriting the
first's metadata. Generation now fails naming both declaration sites.

**Lifetime markers resolve on async factories.** The marker walk enters at the written contract
site with `Promise<>` unwrapped syntactically. Entering at the checker-inferred return type — as
v2 did — found `Promise<ScopedService>`, which has no heritage to the marker, so an `async` factory
silently took the default lifetime instead of the marked one. A `singleton` that should have been
`scoped` is precisely the bug the lifetime-inversion check exists to catch, and this made it
unreachable for every async factory.

## [2.6.0]

### Fixed

Two previously unintercepted ways of referencing the generated registry file from scanned
source are now hard codegen errors. Re-exporting generated names through a barrel
(`export type { Channels } from "./generated/ioc-registry.types.js"`, including
`export * from …`) and `typeof import(…)` / `import(…).X` references to the generated file
both bypassed syntactic interception and fell back to type resolution, which can poison
demand analysis on cold start. Both forms now fail generation with an error naming the
offending file and the supported alternative: import generated types directly.

```ts
// Both of these now fail generation with a pointed error:
export type { Channels } from "./generated/ioc-registry.types.js";
type Cradle = import("./generated/ioc-registry.types.js").IocGeneratedCradle;

// Supported: import generated types directly where they are consumed.
import type { Channels } from "./generated/ioc-registry.types.js";
```

`groups.<name>.allowEmpty` (added in 2.5.0) was rejected by the config loader — the same
hand-maintained-whitelist omission previously behind the `baseTypeArg` (2.2.1) and
`allowLifetimeInversion` (2.3.6) bugs. The key is accepted again; the strict-schema swap
below removes this failure mode by construction.

### Changed

Config validation is now backed by a strict schema: unknown keys and malformed values are
rejected in a single validation artifact, so a config key can no longer be silently ignored
by omission from a hand-maintained whitelist.

### Removed

The public barrel now exports only the essential API surface (config types, runtime
registration, error types, composition entry points). Internal plumbing exports have been
removed from the package entry point.

## [2.5.0]

### Added

- Generation now fails when a configured group resolves to zero members. An empty
  group emits `ReadonlyArray<never>` into the cradle and produces a container that
  boots into a no-op, so this is never a correct emission. The error names the group
  key, base type, and kind, and lists the likely causes.

- `groups.<name>.allowEmpty` suppresses the empty-group failure for a group that is
  intentionally empty:

```ts
  groups: {
    workerTasks: {
      baseType: "WorkerTaskBase",
      allowEmpty: true,
    },
  }
```

App-mode builds do not need this. When a group key is also declared by a composed
package manifest, members arrive at boot via `composeManifests` and the check is
skipped automatically.

- Generation now warns for exported factories that matched the factory prefix but
  could not be registered — `invalid_factory_signature`, `contract_not_found`,
  `contract_not_imported`, `contract_not_resolved`, and `unsupported_pattern`.
  Previously these outcomes were recorded but only visible through `ioc --discovery`.
  Benign skips (non-factory files, config exclusions) stay silent.

### Changed

- **Upgrading may fail a build that previously passed.** Any group that was silently
  resolving to zero members now throws at generation time. This surfaces an existing
  defect rather than introducing one — such a group was already emitting
  `ReadonlyArray<never>` and producing a container with nothing registered. Fix the
  group membership, or set `allowEmpty: true` if the group is intentionally empty.

- Factories whose return type is a bare union are still not discoverable, but no
  longer fail silently. Contract identity is derived from the return type's symbol
  name, and group membership walks `extends` heritage — a union has neither, so such
  factories are skipped with `contract_not_resolved` and now surface as a warning at
  generation time.

  A union is a shape discriminator, not a member enumeration. Give the group a shared
  base and have each implementation reach it through its own contract:

```ts
  export type WorkerTaskBase = {
    name: string;
    run: () => Promise<WorkerTaskOutcome>;
  };

  export type QueueWorkerTask = WorkerTaskBase & { type: "queue"; order: number };

  export interface ThumbnailTask extends QueueWorkerTask {
    name: "thumbnail";
  }

  export const build__thumbnailTask = (): ThumbnailTask => { ... };
```

Bare type aliases of each arm do not work — they collapse through `getApparentType`
back to the base symbol and dedupe into a single contract.

## [2.4.0] - 2026-08-06

### Added

- **`ioc generate` now warns when a single-implementation contract has two cradle names.**
  When a contract's only implementation registers under a key that differs from the contract
  access key (e.g. `buildCreateMediaItemUpload` returning `CreateMediaUpload`), injection
  sites resolve through the contract-key alias while the implementation key appears only in
  generated files — so grepping for the factory's own name finds no usages. Since a
  single-implementation contract gets none of the benefits of the dual naming, codegen now
  emits a warning suggesting the factory (or contract) be renamed so the keys collapse to
  one. Suppress intentionally with `registrations[Contract].$contract.allowDivergentName:
true`. The warning never fires for multi-implementation contracts, contracts with an
  explicit `$contract.accessKey`, or group bases with no elected default.

## [2.3.6] - 2026-07-13

### Fixed

- **The documented `allowLifetimeInversion` escape hatch was unreachable — config
  loading rejected it.** The `IocOverride` type accepted `allowLifetimeInversion` and the
  codegen inversion check consumed it, but `IMPL_OVERRIDE_KEYS` — the per-implementation
  key whitelist in `loadIocConfig` — omitted it, so `assertOnlyKeys` threw
  `[ioc-config] … has unknown property "allowLifetimeInversion"` while loading the config,
  before the inversion check ever ran. Following the documented opt-out therefore cleared
  the codegen error only to hard-fail at config load. The key is now whitelisted, and its
  value is shape-validated (`boolean | non-empty string[]`) alongside the other overrides —
  previously a malformed value such as a string would have loaded without complaint and then
  silently suppressed nothing at codegen, resurfacing the inversion error despite the flag
  being set.

- **`ioc generate` could not load a TypeScript `ioc.config.ts` on Node versions without
  full native type stripping.** The config was pulled in with a bare dynamic `import()`,
  delegating `.ts` execution to the host runtime — which fails outright below Node 22.18 and,
  on newer versions, falls back to strip-only mode that rejects `enum`, `namespace`,
  parameter properties, and other non-erasable syntax. The loader now transpiles the config
  in-process through tsx's scoped `tsImport`, so a TypeScript `ioc.config.ts` loads on every
  supported Node version with no per-project loader wiring or `NODE_OPTIONS`, and the returned
  module is unwrapped tolerant of both the ESM and CJS-interop export shapes tsx can emit.
  `tsx` moves from a dev dependency to a runtime dependency for this reason.
  Discovery is unaffected — it reads factory source as AST through the TypeScript compiler
  API and never executes it.

## [2.3.5] - 2026-07-06

### Fixed

- **Group-only base with two or more implementations aborted at container boot ("no
  default is selected for the contract slot").** Generation correctly suppressed the
  contract-default for a group-only base, but the signal lived only in the generator —
  at runtime `registerContractDefaultAliases` re-elected a default over every contract
  with direct implementations and threw when a group base had two or more and no
  `default: true`. The runtime now derives group-base contracts from the groups manifest
  (already in scope, no manifest schema change) and skips default election for a group
  base with no elected default, mirroring the generator. A group base that does mark an
  implementation `default: true` still registers it; a normal contract with multiple
  implementations and no default still throws, as before.

## [2.3.4] - 2026-07-06

### Fixed

- **Anonymous intersection members emitted a broken `import { __type }` (`TS2305`).** A
  dependency typed through an intersection with an inline anonymous member — e.g.
  `type Cradle = AppCradle & { viewerId: EntityId; … }` — made the emitter name that member
  with the compiler's `__type` placeholder and import it, which nothing exports. Anonymous
  intersection members are now inlined structurally instead of imported; only named members
  are imported, and the anonymous member's own field types are still imported as needed.

## [2.3.3] - 2026-07-06

### Fixed

- **Named group-alias imports could not cold-start (`unresolvable deps type`).** A factory
  typing a dependency as a group's exported alias imported by name from the generated file
  (`import type { Channels } from './generated/ioc-registry.types.js'` then
  `deps: { channels: Channels }`) forced the deps-resolution pass to resolve the alias's
  underlying type, which requires the generated file to already exist. On a clean checkout,
  cleared CI cache, or after deleting the generated file, the import resolved to nothing and
  the run hard-aborted before the file could be written — a chicken-and-egg deadlock. Named
  alias imports are now recognized **syntactically** off the import specifier (the same
  cold-start-safe strategy already used for `IocGeneratedCradle['key']` indexed access) and
  reverse-mapped to their group key, so consumption resolves against the group without ever
  reading the generated file.

## [2.3.2] - 2026-07-05

### Fixed

- **Group alias self-import returned when `generatedDir` is relative (`TS2303` /
  `TS2459`).** The 2.3.1 same-file guard compared the type's absolute declaration path
  against `registryTypesFilePath(generatedDir)` with `path.normalize`, which doesn't
  reconcile a relative `generatedDir` against an absolute path — so in a composed run
  with a project-relative `generatedDir`, a factory importing a group's alias by name
  produced an import of the generated file into itself. Both sides are now resolved to
  absolute, symlink-resolved paths before comparison. As added protection, a self-import
  can no longer suppress the alias's own `export type` declaration, so any residual case
  fails loudly instead of silently. Regenerate after upgrading.

## [2.3.1] - 2026-07-05

### Fixed

- **Importing a generated group type alias produced a self-import (`TS2303` /
  `TS2459`).** When a factory imported a group's generated alias by name, regeneration
  resolved that type to a declaration inside the file being written and emitted an
  import from the file into itself — reserving the name, suppressing the alias's own
  `export type` declaration, and defeating the self-import strip. Types declared in the
  generated registry file (`IocGeneratedCradle`, `IocExternals`, `IocScopeProvided`,
  and emitted group aliases) are now resolved as local references. Regenerate after
  upgrading.

- **Identical members in a compound type were not collapsed.** A composed container
  type emitted `AwilixContainer<IocGeneratedCradle & IocGeneratedCradle & …>` instead
  of a single member. Duplicate members in an intersection or union are now deduped in
  the emitted type.

## [2.3.0] - 2026-07-05

### Added

- **Groups no longer require an elected default implementation.** A base type that
  exists only to define group membership — injected as the group and via each
  member's own key, but never as the base type itself — can now form a group without
  electing a default. No singular contract-default key is emitted for such a base.
  This applies to both generic and non-generic bases; it keys on "group base with no
  elected default," not on whether the type is generic. To keep the base injectable
  on its own, elect a default (`default: true`) as before and its singular key is
  emitted as usual. **This can change generated output:** a group base you previously
  gave a throwaway default purely to satisfy the requirement will lose its singular
  cradle key on regeneration — remove those defaults where the singular was never
  consumed. Regenerate after upgrading.

## [2.2.1] - 2026-07-05

### Fixed

- **`baseTypeArg` was rejected by the config loader.** The fail-fast loader's
  group-key allow-list omitted `baseTypeArg`, so a valid generic-group config was
  rejected before `resolveGroupPlan` (which already accepted it) could run. The key
  is now allowed and validated with the same non-empty-string check, keeping the
  loader and plan resolver consistent.

## [2.2.0] - 2026-07-05

### Added

- **Type-argument declarations for generic groups, with a generation-time member
  gate.** A group over a generic base contract now declares its type argument in
  `ioc.config.ts`. Every member's bound argument is verified `member extends the
group's declared arg` at generation — same satisfaction direction as the externals
  check — and a mismatch fails generation. Declaring the constraint (`<TemplateName>`)
  gives a bounded-heterogeneous group where each member narrows it; declaring a
  literal (`<"shareInvite">`) gives a homogeneous group. The cradle emits
  `ReadonlyArray<Base<declaredArg>>` for the collection. Failures aggregate: every
  mismatch prints, then generation throws once naming each group, member, and both
  args.

- **Generic required-parameter bases must declare a group argument.** A group over a
  generic base whose type parameter is required now fails generation with a
  diagnostic naming the group and base when no argument is declared, instead of
  emitting a bare reference. **This can surface a previously-passing build** if such a
  group slipped through as uncompilable output. Bases whose parameter has a default
  may omit the argument. Regenerate after upgrading.

### Fixed

- **An alias of a generic-with-default gained a spurious type argument (`TS2315`).**
  `type KnexConfig = Knex.Config` (where `Config<SV = any>`) emitted `KnexConfig<any>`
  against an alias that takes no parameters. Type-argument emission is now clamped to
  the arity of the printed name: zero-arity names emit bare, only concrete arguments
  render.

- **The generated types file could import a name it also declares (`TS2440`).** In
  composed mode a cross-package reference could pull another package's
  `IocGeneratedCradle` into the import list of a file that also declares its own.
  Locally-declared names (`IocGeneratedCradle`, `IocExternals`, `IocScopeProvided`,
  emitted group aliases) are now stripped from the import buckets. Indexed-access
  references (`IocGeneratedCradle["key"]`) are unaffected.

## [2.1.0] - 2026-07-05

### Added

- **Named type-alias exports for groups.** The generated registry types file now
  emits an `export type` alias for every group, named as the group's access key in
  PascalCase (`channels` → `Channels`). The alias equals the exact aggregate the
  group resolves to — `ReadonlyArray<Base>` for collection groups, the keyed `{ … }`
  object for object groups — so you can import the name directly instead of reaching
  through the cradle:

```ts
// before
type Deps = {
  strategies: IocGeneratedCradle["fastSweepNotificationStrategies"];
};
// now
import type { FastSweepNotificationStrategies } from "./generated/ioc-registry.types.js";
type Deps = { strategies: FastSweepNotificationStrategies };
```

**Collision guard:** if a group's PascalCase alias would collide with an imported
contract type name or another alias, or would not be a valid identifier, that one
alias is skipped with an `[ioc-warn]` naming the group — the indexed-access form
still works, so the generated file always compiles. The plural-group-vs-singular-
interface convention means this is rare. Regenerate (`ioc generate`) to pick up
aliases.

### Fixed

- **Generic type arguments were dropped from generated cradle types.** A factory
  returning a generic instantiation (e.g. `Strategy<"album.shared">`) emitted the
  bare interface name in the cradle, producing uncompilable output for any generic
  whose type parameter is required (`TS2314: requires 1 type argument`). The emitter
  now preserves the full instantiation: named-type arguments are imported, literal
  arguments inline (`Strategy<"album.shared">`), and nested/compound arguments resolve
  through the same pipeline. An **un-instantiated** type parameter reaching the cradle
  now fails generation with a clear diagnostic rather than emitting bad output — so a
  factory that was quietly under-typed surfaces loudly. Regenerate after upgrading.

## [2.0.0] - 2026-06-26

### Removed

- **Automatic plural-collection registrations.** A contract with more than one
  implementation no longer auto-registers a plural collection key (e.g.
  `workerHandlers: ReadonlyArray<WorkerHandler>`) in the cradle or at runtime. Declare
  an explicit `kind: "collection"` group in `ioc.config.ts` instead — groups are now the
  single mechanism for resolving all implementations of a base type as an array. This
  also frees the plural name for use as a group root key.

### Migration

- If you consumed an auto-generated plural key, add a collection group over that base
  type and consume its root key. A leftover reference to a removed plural key now fails
  generation with an unknown-cradle-key diagnostic naming the key.
- The array wrapper's lifetime changes from member-derived (singleton/scoped/transient)
  to always-transient, matching all group roots. Member instances still resolve at their
  own lifetimes; only the array object's caching changes. This is strictly safer (a
  transient wrapper can never freeze a transient member).

## [1.5.1] - 2026-06-23

### Added

- **Awesome new documentation!!!**

## [1.5.0] - 2026-06-23

### Added

- **Lifetime-inversion detection at generation time.** `ioc generate` now flags dependency edges where a longer-lived registration depends on a shorter-lived one — the case where a **singleton that holds a scoped (or transient) dependency freezes that dependency at first construction** and reuses the same instance across every later scope/request. The check is per-edge over the resolved graph and uses the demanded cradle keys directly, so it resolves each dependency precisely (a specific registration key, a contract's default slot, a collection, a group's members, or a scope-provided key) rather than guessing across a contract's implementations.
  - **`singleton → scoped`** (including a scope-provided dependency, or a group whose member is scoped) is an **error** and fails generation. This is almost never intentional: the scoped instance is captured once and never refreshed, so per-request state (a unit-of-work/transaction, a request context) silently goes stale.
  - **`singleton → transient`** and **`scoped → transient`** are **warnings** (`[ioc]`-prefixed) — sometimes intentional (e.g. a singleton holding a transient factory it invokes per use), so they surface for review without blocking.
  - Findings are aggregated: every warning prints, and if there are any errors, generation throws once with the full list rather than failing on the first.
- **`registrations[Contract][impl].allowLifetimeInversion`** opt-out for intentional inversions. Set `true` to allow all shorter-lived dependencies for that implementation, or a `string[]` of demanded keys to allow only those edges (preferred — other inversions stay visible). The field is config-only and is not emitted into the manifest.

### Notes

- **This can surface a previously-passing build.** A `singleton → scoped` edge that generated fine before now fails `ioc generate`, because the freeze it describes was already a latent bug — the generator is making a silent defect loud. Fix the lifetime (usually the consumer should be `scoped`), or, if the inversion is deliberate, mark it with `allowLifetimeInversion`. The check runs on the next `ioc generate`; no regeneration of existing output is required to adopt it.
-

## [1.4.2] - 2026-06-15

### Fixed

- **Same-package group consumption emitted `unknown`.** A factory consuming a group declared in its own package via `IocGeneratedCradle['groupKey']` emitted `groupKey: unknown` in the generated cradle, because the generator resolved the reference by type-checking its own prior output — a circular read that resolved to `unknown` and then re-wrote `unknown` on every regen. Cradle references are now resolved **syntactically from source**, with no dependency on the previously generated file. This also covers **aliased imports** (`import { IocGeneratedCradle as X }`, consumed as `X['groupKey']`) and **cold starts** where no generated file exists yet. Regenerate (`ioc generate`) after upgrading.
- **Cold-start abort on cradle references.** Deleting the generated directory and regenerating could abort with `unresolvable deps type` for any factory referencing the cradle, because the reference had no prior output to resolve against. The syntactic resolution above removes this dependency, so first-run and post-clean generation succeed.

### Changed

- **Unknown consumed cradle keys now throw instead of silently emitting `unknown`.** Consuming a cradle key that is neither a known registration nor a declared group (e.g. a typo like `IocGeneratedCradle['channel']` instead of `'channels'`) now fails generation with a diagnostic naming the offending key. **This can surface a previously-passing build:** such a key used to resolve silently to `unknown`. The code was already wrong — it was producing `unknown`, not the intended type — so this turns a silent defect into a loud one pointing at the typo.
-

## [1.4.1] - 2026-06-14

### Fixed

- **Composed externals satisfaction was checked in the wrong direction.** The generated `ioc-composed.ts` assertions (and the `ioc validate` type check) compared the _demanded_ external type against the _supplied_ type backwards — effectively requiring the demanded type to contain everything the supplier provides. This wrongly **rejected valid subset externals** (a package demanding a minimal slice of a type the composition supplies in full) and wrongly **accepted under-supply** (a package demanding more than what's supplied). Satisfaction now correctly requires the supplied type (`AppCradle[K]`) to be assignable to the demanded type (`Externals[K]`) — the supplier must provide _at least_ what's demanded. Regenerate (`ioc generate`) after upgrading so composed files carry the corrected assertions.

## [1.4.0] - 2026-06-14

### Added

- **Per-key composed externals assertions.** The generated `ioc-composed.ts` now emits one type assertion per external key (`_<Pkg>_<key>Assert`) instead of a single bulk assertion per package. When an externals check fails, the `tsc` error (`TS2344`) names the specific failing key — no more reverse-engineering which dependency broke from a package-level assertion. The per-key assertions preserve the exact pass/fail semantics of the previous bulk `Pick<AppCradle, keyof Externals>` check, including for object-typed externals with optional or union members (e.g. a `config` external whose value has a `logLevel` union and an optional `logJsonFilePath`).
- **Type-mismatch diagnostics in `ioc validate`.** When a composed external is supplied but its type doesn't match what the consuming package demands, `validate` now reports the key, the demanding package, the supplying source, and both type texts — plus the first mismatched property when a TypeScript checker is available. Previously a type mismatch surfaced only as an opaque compile-time assertion failure. The generated assertions carry a comment pointing at `ioc validate` for this explanation.

### Changed

- **`validate` distinguishes two externals failure modes:** a key supplied by no manifest ("nothing builds it") versus a key supplied but type-incompatible. The messages differ so the cause is unambiguous.

### Notes

- When `validate` cannot construct a TypeScript checker (e.g. no resolvable `tsconfig`), supplied keys are reported with a warning that type compatibility was not verified — a passing `validate` no longer implies type satisfaction in that case. `tsc` remains authoritative.
- Generated-output change: regenerate (`ioc generate`) after upgrading so composed files carry the per-key assertions. Pass/fail behavior is unchanged from 1.3.x for any existing composition — only the granularity and error messaging improve.

## [1.3.0] - 2026-06-14

### Added

- **`scopeProvided` config field for runtime scope-registered values.** Declares dependency keys supplied at runtime by registering onto a request child scope (e.g. `scope.register({ viewerId: asValue(...) })`) rather than built by any factory. These keys are excluded from the externals-satisfaction check, so composing a manifest that demands them no longer requires a factory to build them. Typical cases: per-request values like `viewerId`, `tenantId`, `requestId`.
- **`IocScopeProvided` generated interface.** Declared scope-provided keys are emitted into a dedicated interface (with a JSDoc reminder to register them onto a child scope) instead of `IocExternals`, documenting the runtime contract at the type level.
- **`IOC_SCOPE_PROVIDED_KEYS` export** in the generated manifest — a `readonly` tuple of the package's scope-provided keys, for app code that wants to assert its scope setup covers them.
- **Generation-time guards.** Declaring a `scopeProvided` key that no factory demands emits a `[ioc-config]` warning (typo guard); declaring one that a local factory also builds is a hard error — a key cannot be both manifest-built and scope-provided.

### Notes

- Purely additive and opt-in — no migration required. Packages that don't set `scopeProvided` are unaffected: the new interface emits empty and the new export is an empty tuple.
- The contract is enforced at runtime, not compile time. Resolving a scope-provided service without registering its value throws `IocResolutionError` (Awilix), never a placeholder. Richer messaging for missing scope values is deliberately deferred.

## [1.2.1] - 2026-06-04

### Fixed

- **Nominal heritage walker no longer silently fails on aliased symbols.** When a lifetime marker or group base type was reached through an import or type alias, the walker stopped resolving heritage — leaving groups with no members and factories without lifetime-marker tagging. Aliased symbols are now followed to their target declaration, so `extends` / `&` heritage that passes through an alias is recognized.

## [1.2.0] - 2026-06-04

### Changed

- **Group and lifetime-marker membership is now nominal (declared `extends` / type-alias `&`), not structural.** Empty marker interfaces and empty group base types no longer match every type in the package. Factories and contracts must declare heritage explicitly (`interface Foo extends ReadServiceBase`, `type Bar = Baz & IScoped`). This is a minor semver bump because membership semantics change even though most code that already uses `extends` is unaffected.
- **`group_no_matches` is no longer a hard codegen error.** Groups with zero local members are emitted empty and produce an `[ioc-warn]` suggesting `extends` on implementations. Empty groups remain valid for app-mode composition and in-progress refactors.
- **Migration:** No codemod. Remove optional brand fields from markers if you added them only to work around structural over-matching in v1.1.x; `extends` on service/contract types is sufficient. Existing branded markers still work.

## [1.1.5] - 2026-06-04

### Fixed

- **Composed package export paths ending in `.js` now resolve to on-disk TypeScript source.** When `package.json` `exports` point at a `.js` path (the modern TypeScript convention where import specifiers use `.js` but the file on disk is `.ts`), existence checks and manifest loading use the matching `.ts`, `.tsx`, `.mts`, or `.cts` file. Same mapping applies to `.mjs` → `.mts` and `.cjs` → `.cts`.
- **Export resolution "file does not exist" errors now display the subpath import cleanly** (e.g. `@packages/media-core/iocManifest`) instead of concatenating package name and subpath into a malformed name like `@packages/media-core./iocManifest`.

## [1.1.4] - 2026-06-04

### Fixed

- **Deps-property types declared in the factory file now get correct imports** in generated `ioc-registry.types.ts`. Previously, if a factory declared its deps type _and_ the deps' property types in the same file as the factory (e.g. `type Config = { ... }; type Deps = { config: Config };` alongside `buildFoo`), the property types were referenced in `IocExternals` without an import statement, causing TS2304 errors at consumer compile time. Now those types are correctly imported.
- Multiple same-file types referenced by a single factory are merged into a single import line.

### Notes

- Anonymous structural types (e.g. branded primitives like `string & { __brand: "X" }`) continue to inline correctly. Only top-level named types (`type`, `interface`, `enum`) declared in the factory file now trigger imports — the case where the named declaration is genuinely required at the import site.

## [1.1.3] - 2026-06-04

### Fixed

- **Composed package export resolution now respects `customConditions`.** When loading another package's `iocManifest` and `iocTypes` subpath exports for app-mode codegen, the resolver now honors `customConditions` from the user's tsconfig. Previously, conditional exports without an `import` condition would silently resolve to `types` (`.d.ts` files), causing stale or incorrect manifest data.

### Added

- **`loadIocTsconfigContext` helper** centralizes tsconfig parsing so both program construction and export resolution consume the same parsed options. No public API change; internal refactor that closes a class of "config option not threaded through" bugs.

### Changed

- The resolver no longer falls back to the `types` condition for value loading. `.d.ts` files don't contain manifest values; falling back to them produced confusing errors. Now errors with guidance to add a `development`, `import`, or `default` condition when only `types` is declared.

## [1.1.2] - 2026-06-04

### Fixed

- **Cross-package type imports now use bare specifiers when the factory does.** When a factory imports a type via a bare package specifier (e.g. `import type { MediaStorage } from '@packages/media-core'`), the generated `ioc-registry.types.ts` and `ioc-manifest.ts` now preserve that specifier instead of emitting a deep relative path into the source package. This restores the package-boundary discipline v2 was designed to enforce in monorepo setups.

### Added

- **Warning when generated imports escape the package root.** Codegen now emits a `[ioc-warn]` when a generated relative import walks outside the package's directory. Informational only; codegen completes normally. Surfaces the issue without forcing immediate action.

### Notes

- The fix covers both deps-type imports (in `ioc-registry.types.ts`) and return-type imports (in `ioc-manifest.ts`). Both code paths now use a shared bare-specifier recovery helper.
-

## [1.0.1] - 2026-05-23

### Changed

- Codegen no longer prints TypeScript diagnostics on every run when discovery files have compile errors. Compiler errors in scan targets are shown only when generation fails for a type-checking-related reason (for example, a file missing from the program, unresolvable factory deps types, or conflicting demanded key types).

## [1.0.0] - 2026-05-22

Major release: per-package manifests with app-level composition. Hard cut from v1 — no backward compatibility ([§13](docs/design/per-package-manifest.md#13-breaking-changes-summary)).

### Added

- Per-package manifest generation: each package scans only its own source and emits `ioc-manifest.ts` plus registry types ([§2](docs/design/per-package-manifest.md#2-design-overview), [§4.2](docs/design/per-package-manifest.md#42-generated-artifacts-per-package)).
- `composedManifests` and `manifestExportPath` on `ioc.config` for app-mode composition and package export paths ([§6](docs/design/per-package-manifest.md#6-app-level-composition-glue), [§12.1](docs/design/per-package-manifest.md#121-added)).
- App-mode codegen: `ioc-composed.ts` with `composedManifests`, `AppCradle`, and compile-time `IocExternals` satisfaction assertions ([§6](docs/design/per-package-manifest.md#6-app-level-composition-glue)).
- Runtime manifest composition via `composeManifests` / `registerIocFromManifest(container, manifests)` with set-like semantics ([§5](docs/design/per-package-manifest.md#5-composition-api)).
- `registrations[…][impl].source` (`'local'` or package name) to resolve same-key conflicts across composed manifests ([§5.2](docs/design/per-package-manifest.md#52-same-registration-key-from-two-manifests), [§7](docs/design/per-package-manifest.md#7-app-level-overrides)).
- `IocExternals` interface listing demanded keys with no local supplier ([§4.3](docs/design/per-package-manifest.md#43-iocgeneratedcradle-shape)).
- Demand/supply analysis over factory deps types, including cross-factory type agreement validation ([§4.1](docs/design/per-package-manifest.md#41-validation-rules-during-codegen)).
- Codegen enforcement of named local deps types at factory sites (no `IocGeneratedCradle` destructure) ([§3](docs/design/per-package-manifest.md#3-the-factory-site-pattern)).
- `manifestSchemaVersion: 2` on emitted manifests; runtime refuses incompatible versions at composition ([§14.2](docs/design/per-package-manifest.md#142-manifest-versioning-resolved-ship-on-day-one)).
- `ioc validate` CLI (app mode): aggregated cross-manifest checks for externals, same-key conflicts, groups, defaults, and schema version; `--json` for CI ([§9.2](docs/design/per-package-manifest.md#92-ioc-validate-new)).
- Cross-manifest group merging by canonical base-type identifier (`<path>:<TypeName>`) ([§8](docs/design/per-package-manifest.md#8-groups-across-manifests)).
- `groupBaseTypeAliases` in app-mode config for diamond-dependency / hoisting base-type equivalence ([§14.4.1](docs/design/per-package-manifest.md#1441-manual-base-type-aliases-ship-on-day-one)).
- Optional `ComposedRegistrationOverrides` argument on `registerIocFromManifest` for app-config-driven composition policy.
- `examples/multi-package` workspace demonstrating library packages, app composition, externals assertions, and validate/typecheck scripts.

### Changed

- `registerIocFromManifest` now accepts `readonly IocManifest[]` (and optional overrides) instead of a single manifest ([§5](docs/design/per-package-manifest.md#5-composition-api)).
- `IocGeneratedCradle` contains only locally supplied keys; externally demanded keys live in `IocExternals` ([§4.3](docs/design/per-package-manifest.md#43-iocgeneratedcradle-shape)).
- Default implementation selection precedence extended for composition: app `default: true` override, then manifest-declared defaults, then single-impl / convention fallback ([§5.1](docs/design/per-package-manifest.md#51-same-contract-multiple-implementations-across-manifests)).
- Error prefixes standardized: `[ioc-config]` for config, `[ioc]` for discovery, and category prefixes (`[externals]`, `[same-key-conflict]`, `[group-base-type]`, etc.) for `ioc validate` ([§9](docs/design/per-package-manifest.md#9-cli)).
- `ioc generate` branches on config: library mode emits two artifacts; app mode emits three (including `ioc-composed.ts`) ([§9.1](docs/design/per-package-manifest.md#91-ioc-generate)).

### Removed

- Cross-package `scanDirs` (paths outside the package root are rejected; use `composedManifests` instead) ([§13](docs/design/per-package-manifest.md#13-breaking-changes-summary), [§12.2](docs/design/per-package-manifest.md#122-removed)).
- `discovery.scanDirs[].importPrefix`, `importMode`, and `discovery.workspacePackageImportBases` ([§12.2](docs/design/per-package-manifest.md#122-removed)).
- `IocGeneratedTypes` type alias; use `IocGeneratedCradle` directly in generated `ioc-registry.types.ts`.
