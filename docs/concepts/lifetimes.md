# Lifetimes

Every registration has an Awilix lifetime — `singleton`, `scoped`, or `transient`. This page covers the three ways to assign them (markers, folder scope, explicit config), the rule that decides whether a combination of them is sound, the generation-time check that enforces it, and the two ways a real migration hit that check hardest.

## Lifetime markers

When services are organized by domain (`src/users/`, `src/orders/`) rather than by lifetime category, folder-scoped lifetimes fit poorly. **Lifetime markers** express cross-cutting lifetime policy via marker interfaces — the same **nominal** membership rules groups use (declared `extends`, not structural assignability).

### Defining a marker

A marker is typically an empty interface (or a type alias you intersect with). Selective matching comes from **where you attach `extends`**, not from branding:

```ts
// shared types
export interface IScoped {}

export interface ITransient {}
```

### Declaring markers

Map marker types to lifetimes in `ioc.config`:

```ts
lifetimeMarkers: {
  IScoped: "scoped",
  ITransient: "transient",
},
```

Keys are interface or type-alias names visible in the package's TypeScript program at codegen. Values are `singleton`, `scoped`, or `transient`. An empty object `{}` skips marker analysis.

### Attaching markers to units

Three attachment points, in order of locality. The pattern that fits your code best is usually the right one. Markers resolve from a unit's contract site, so a class's `implements` contract carries them exactly as a factory's return annotation does.

**Directly on the implementation type:**

```ts
export interface RequestTracingLogger extends LoggingService, IScoped {
  ping: () => string;
}
```

**On a shared contract** (every implementation of `LoggingService` becomes scoped):

```ts
export interface LoggingService extends IScoped {
  log: (msg: string) => void;
}
```

**On a group base type** — and for a group, the *only* place. Lifetime is a property of the family, so a grouped member may not declare its own (a marker on the member's contract that the base lacks, or a per-implementation `lifetime` override, is a hard error). Every implementation in the group inherits the base's lifetime, reported with provenance `group-base-marker`:

```ts
export interface DiscountStrategy extends IScoped {
  applies: (order: Order) => boolean;
  calculate: (order: Order) => number;
}
```

Transitive inheritance does the rest. You attach the marker once on the right level of abstraction; codegen finds it on every implementation downstream.

### Precedence

For any unit, the lifetime resolves in this order (highest first):

1. `registrations[Contract][impl].lifetime` — explicit per-impl override
2. Lifetime marker on the contract (return annotation or `implements` clause)
3. `discovery.scanDirs[].scope` — folder-scoped default
4. Default: `singleton`

For a **grouped** contract this chain does not run at all: the group's base declares the lifetime and the member ranks it. Rows 1 and 2 are not outranked there — they are refused, because a member is not entitled to make the claim. See [Groups](/concepts/groups#lifetime-belongs-to-the-group).

A lifetime marker never induces group membership, and a group base carrying one does not change membership semantics. Grouping is decided by `config.groups` base types; lifetimes by `lifetimeMarkers`. A contract extending both a group base and a marker joins the group and ranks the lifetime; a contract extending only a marker joins nothing.

### Multiple markers is a hard error

If a contract matches two markers, codegen errors and names both. Silent first-wins would create the worst kind of bug — a service's lifetime quietly differs from what the developer intended. Resolve by removing one marker from the inheritance chain or setting the lifetime explicitly via `registrations`.

### Cross-package behavior

Marker types must be declared in source files visible to the package's TypeScript program at codegen — typically the same package's `src/`. Library packages bake their resolved lifetimes into their manifest at _their_ codegen time; composing apps do not re-run marker resolution on library factories. A library's choice of marker is invisible to consumers; what they see is the resolved lifetime in the registration.

## Folder-scoped lifetimes

Folder-scoped lifetimes are a **legacy pattern** for codebases where directory layout mirrors lifetime boundaries. For domain-organized code, prefer [lifetime markers](/concepts/lifetimes#lifetime-markers) instead.

If implementations are co-located by lifetime category, you can default lifetimes by scan root:

```ts
discovery: {
  scanDirs: [
    { path: "src/services", scope: "scoped" },
    { path: "src/repos", scope: "scoped" },
    { path: "src/infra", scope: "singleton" },
    { path: "src/handlers", scope: "transient" },
  ],
},
```

This came out of a real pattern: in a GraphQL API, services and repositories are scoped to the request, infrastructure clients (database pools, caches) are singletons, and HTTP handlers are transient. Instead of repeating that in `registrations` for every single factory, you express it structurally — the directory _is_ the policy.

Per-implementation overrides in `registrations` and lifetime markers take precedence over folder scope.

## The floor rule

One sentence governs every combination of lifetimes in a container:

> **A unit lives at most as long as its shortest-lived dependency.**

It is not a policy this tool invented; it is what a container does. A `singleton` is constructed once and the instance it was handed at construction is the instance it holds forever. If that instance was meant to last one request, the singleton has quietly extended it to the life of the process. The dependency's lifetime is a *ceiling* on the consumer's, and the consumer either lives under it or breaks it.

Two things follow.

**A longer-lived unit cannot hold a shorter-lived one.** That is the whole of the [inversion check](/concepts/lifetimes#lifetime-inversion-checks): it ranks every dependency edge and reports the ones where the floor was breached.

**Lifetime propagates upward through a dependency tree.** If a repository holds a per-request unit of work, the repository is per-request. If a write service holds that repository, the write service is per-request too. Nothing about the write service *itself* is request-scoped — it has no state, it just calls methods — and it is scoped anyway, because one of its dependencies is.

### Why repositories are scoped

This is the question that comes up in every migration, usually phrased as "why can't my repository be a singleton, it has no state".

Because it takes a `uow`. A unit of work is a transaction handle: one per request, opened when the request starts and committed or rolled back when it ends. A repository holding one is holding *this request's* transaction, so the repository is per-request by the floor rule. And everything that holds the repository — the write service, the command handler, the resolver that calls them — is per-request for the same reason. The unit of work is the floor, and the entire write tree stands on it.

The read tree, which does not take a `uow`, is under no such constraint. That asymmetry is normal and worth keeping: it is why a read service can be a singleton in the same codebase where its write counterpart cannot.

The practical form of this is that you do not decide a unit's lifetime by looking at the unit. You look at what it demands. `ioc explain <key> --discovery` prints exactly that list with each dependency's lifetime next to it, which is usually the fastest way to answer "why is this scoped".

## Lifetime inversion checks

::: warning Upgrading to 4.1 — new errors on code that generated cleanly before
4.1 ranks dependency edges that cross into a composed package. Until then, every key a composed manifest supplied was classified as an external and skipped, so a singleton in one package holding a scoped registration in another was ranked by nobody. A composed monorepo can expect several inversions on the first run after upgrading.

**None of them is new breakage.** Each is a real captive dependency that has been resolving wrongly for as long as it has existed, and that nothing reported: a singleton freezing a scoped instance at first construction and reusing it across every scope. Where the scoped registration is a unit of work, that is one transaction object serving every request.

Resolve them rather than suppressing them. The usual fixes are moving the consumer behind a [scope opener](/concepts/scope-roots) so it is built per request, or giving it a dependency that does not need request scope — a raw handle rather than the scoped wrapper. `allowLifetimeInversion` (below) remains available where the inversion is genuinely intended, and remains the wrong answer where it is not.
:::

Awilix lifetimes have an ordering: a `singleton` lives for the life of the container, a `scoped` instance lives for one scope (typically one request), a `transient` is rebuilt on every resolve. When a longer-lived registration depends on a shorter-lived one, the longer-lived service captures a single instance of that dependency at first construction and reuses it forever — quietly defeating the shorter lifetime.

The classic case: a `singleton` that depends on a `scoped` repository holding a per-request unit-of-work. The singleton is built once, captures one repository, and every later request writes through that first request's transaction. Nothing throws; the state just silently goes stale. The consumer doesn't even have to touch the scoped resource — holding something that holds it is enough.

`ioc generate` catches this statically. It walks every dependency edge over the resolved graph and flags any edge where the dependency is shorter-lived than the consumer:

- **`singleton → scoped`** is an **error** — generation fails. This includes a scoped dependency reached through a group (a group with a scoped member) or a scope-provided key (per-request, so effectively scoped). It is almost never intentional.
- **`singleton → transient`** and **`scoped → transient`** are **warnings** (`[ioc]`-prefixed). A singleton legitimately holding a transient factory it constructs from per use is a real pattern, so these surface for review without blocking. Note that the default runtime is stricter than this ranking and will throw on them — see [The runtime is strict](#the-runtime-is-strict).

The check resolves each demanded key precisely — a specific registration key, a contract's default slot, a group's members, or a scope-provided key — so it names the exact dependency rather than guessing across a contract's implementations. Findings aggregate: every warning prints, and if there are errors, generation throws once with the full list rather than failing on the first one.

A typical error. The sentence states the rule, the pointer names the page that articulates it, and each offender line is the mechanism — which unit, which dependency, which lifetimes, and what that does at runtime:

```
[ioc] 1 lifetime inversion. A unit lives at most as long as its shortest-lived dependency, and these outlive theirs:
→ docs: https://reharik.github.io/ioc-manifest/concepts/lifetimes#the-floor-rule
  - [lifetime-inversion] 'grantSync' (singleton) depends on 'grantRepository' (scoped) — a singleton freezes its scoped dependency at first construction and reuses it across every scope.
Fix by registering the consumer at the shorter lifetime, or mark an inversion intentional with registrations[<Contract>].<impl>.allowLifetimeInversion in ioc.config.
```

The usual fix is the obvious one — the consumer should be `scoped`:

```ts
registrations: {
  GrantSync: {
    grantSync: { lifetime: "scoped" },
  },
},
```

**Intentional inversions.** If an inversion is deliberate — a singleton that holds a transient factory and constructs from it per call — opt out with `allowLifetimeInversion` on that implementation:

```ts
registrations: {
  ConnectionPool: {
    // allow all shorter-lived deps for this implementation:
    connectionPool: { allowLifetimeInversion: true },
    // or allow only specific demanded keys (preferred):
    // connectionPool: { allowLifetimeInversion: ["connectionFactory"] },
  },
},
```

Prefer the `string[]` form. `true` silences every inversion for that consumer — including ones you introduce later and didn't mean to. Listing the keys you're knowingly inverting keeps the rest of the check live. The field is config-only and never appears in the generated manifest.

### Across a composed boundary

In app mode the check reads every [composed package's](/monorepo/composition) manifest as supply and ranks edges into it on the same terms as local ones. It did not always: every key a composed manifest supplies is an *external* from the consuming package's point of view, the externals gate ran first, and so every edge crossing the boundary was skipped. Neither side ranked them — the consuming package could not see the dependency's lifetime, and the supplying package could not see the consumer.

**"Skip" now means one thing.** A demanded key is skipped only when it is genuinely supplied by the composing app at bootstrap and no manifest anywhere states a lifetime for it, so there is nothing to rank against. It no longer means "supplied by any manifest other than this one". Direct edges, contract default slots, and group hops into a composed package are all ranked; a scope-provided key is ranked as per-request ahead of everything, since the app registers it onto the scope whatever a manifest says.

**Composed group roots merge with local ones**, the way composition merges them at runtime: a group key present in both places ranks the union of the members, and the cradle hands out that union. That is what makes all three shapes rankable — a root only a library declares, a locally empty root whose members all arrive by composition, and the mixed root with some of each. A member's lifetime is read from the local plan first and **falls back to the composed unit** that registers it.

A dependency that lives in another package says so, because the fix is written *here* while the lifetime being complained about is written *there*:

```
[lifetime-inversion] 'mediaGrantService' (singleton) depends on 'mediaItemReadRepository'
(scoped, composed package "@app/media-core") — a singleton freezes its scoped dependency at
first construction and reuses it across every scope.
```

Anything unannotated in a report is this package's own.

**A member that cannot be ranked is disclosed, not dropped.** A mixed group used to report its local members, silently omit the ones it could not resolve, and return a verdict that read as complete. An unranked edge is not a cleared edge, so it now prints as its own warning naming the member and which of three reasons applies:

```
[ioc] [lifetime-inversion] 'grantSync' (singleton) depends on group 'writeServices' member
'archiveWrite', whose registration 'archiveWrite' has no lifetime this run can read (a composed
group root names it, but no manifest this run read registers it) — that edge is UNRANKED, not
cleared.
```

The three reasons are the composing app supplying that key at bootstrap with no declared lifetime; a composed group root naming a member no manifest this run read registers; and no local registration and no composed manifest carrying it at all. It appears for **non-transient consumers only** — a transient consumer outlives nothing, so no lifetime the member turned out to have could have produced a finding, and disclosing an edge that could not have been reported either way is noise rather than honesty.

One consequence is worth stating plainly: the guarantee is "checked wherever the members were visible at generation", not "checked, unconditionally". A run that ranks a group root without composed supply — generating against a stale manifest, or an app generated by a version predating this wiring — ranks the local members and no others, and a composed member's lifetime was then never ranked by anything, here or there. Regenerate the app after regenerating its libraries.

## The runtime is strict

`registerIocFromManifest` turns on Awilix **strict mode** by default. Strict is Awilix's own runtime correctness net: it refuses to register a singleton on a scoped container, resolves singletons against the root container so one cannot capture a scope, and — the check that matters here — **throws at first resolve when a longer-lived unit is handed a shorter-lived dependency**, instead of quietly freezing the first instance.

Opt out per container:

```ts
registerIocFromManifest(container, composedManifests, overrides, { strict: false });
```

Three things are worth stating plainly, because this is one place where the static model and the runtime do not line up.

**A statically WARNED inversion throws at runtime.** The severity split above is ours: `singleton → transient` and `scoped → transient` are warnings here because holding a transient factory and constructing from it per call is a real pattern. Awilix strict does not make that distinction — it errors on every inversion it can see. So an edge that generation merely *warned* about will fail at first resolve under the default runtime. The warning says so where it fires:

```
[ioc] [lifetime-inversion] 'grantSync' (singleton) depends on 'token' (transient) — a longer-lived
consumer holding a shorter-lived dependency keeps the first instance it was given. Under the default
runtime this edge throws at first resolve: `registerIocFromManifest` enables Awilix strict mode
unless you pass `{ strict: false }`, and `allowLifetimeInversion` suppresses this report only — it
is not a runtime exemption.
```

**`allowLifetimeInversion` is not a runtime exemption.** It suppresses the *static report* and nothing else. There is no flag in `ioc.config` that reaches into the container. If you suppress an inversion you own what it does at runtime, and you have exactly two honest options: fix the edge, or pass `{ strict: false }` and accept the old tolerance for the whole container. Suppressing and leaving strict on gets you a silent config and a crash.

**Strict backstops DIRECT edges only — group edges are static-only by construction.** Awilix ranks a dependency against whatever is on its resolution stack at the moment it resolves. A group member is not resolved there: group member slots are lazy, and the read usually happens at call time, long after the enclosing `resolve()` returned (see [Members resolve when you read them](/concepts/groups#members-resolve-when-you-read-them)). There is no stack for Awilix to rank the member against, so a `consumer → group → member` inversion is invisible to strict. The generation-time check walks that hop explicitly and is the **only** guard on it. Nothing about turning strict on changes that, and nothing about turning it off weakens it.

A member's *own* direct edges are still checked normally — reading a member starts its own resolution, so a member that itself holds something shorter-lived throws exactly as a direct resolve of it would.

Contract default slots (`aliasTo`), group roots, and scope-root openers are all registered transient for reasons that have nothing to do with how long their values live, and are marked leak-safe so strict does not read that detail as a leak. Injecting an opener or a group into a singleton works.

**`isLeakSafe` on a group root is not a clearance for what is inside it.** It says the root itself holds nothing — a group value is inert, and a transient registration of it would otherwise read to strict as a leak into any singleton that demands it. It says nothing about the member the consumer eventually reads. Awilix could not rank that edge even if the root were not marked: the member slot resolves lazily, with no enclosing `resolve()` on the stack to rank it against. So a singleton demanding a group whose members are scoped is a real captive dependency that strict will never see, in either mode, and the generation-time check is genuinely the only place it is caught.

## The captive dependency

This is the incident the inversion check was written for, and it is worth reading even if you never see the error, because the failure mode is silent.

A sync job — call it `grantSync` — was registered as a `singleton`. It ran on a timer, it held no state of its own, and singleton was the obvious choice. It depended on `grantRepository`, which was `scoped`, because `grantRepository` takes a `uow`.

Awilix built `grantSync` once, on first resolve. To build it, it resolved `grantRepository` once. To build *that*, it resolved `uow` once — the unit of work belonging to whichever request happened to trigger the first construction. That transaction handle then lived inside the singleton forever. Every subsequent run of the sync job wrote through the first request's transaction: a transaction that had already been committed, on a connection that had long since been returned to the pool.

Nothing threw. There was no error to catch, no log line to find. Writes went to a handle nobody was watching, and the symptom surfaced days later as data that should have existed and did not.

Two properties make this class of bug worth a build-time check rather than a code review rule:

- **It is invisible at the consumer.** `grantSync` never mentions `uow`. It holds a repository, and the repository holds the transaction. Holding something that holds it is enough, so reading the singleton's own source tells you nothing.
- **It is created by a change somewhere else.** `grantSync` was correct on the day it was written. It became wrong when `grantRepository` gained a `uow` dependency — a change in a different file, made for a different reason, by someone who had no reason to look at the sync job.

That is why `singleton → scoped` is an error rather than a warning: it is nearly always this bug, and the cost of the false positive (adding `lifetime: "scoped"` to a job that did not need it) is nothing next to the cost of the false negative.

## The ungrouping cliff

The second incident is about what happens when a unit *leaves* a group.

Lifetime for a grouped contract is [declared on the group's base](/concepts/groups#lifetime-belongs-to-the-group), and every member inherits it. A family of write services extending `WriteServiceBase`, whose base carries a `scoped` marker, is `scoped` — all of it, with nothing said at any member.

Now remove one member from the family. Perhaps its contract stopped extending the base during a refactor; perhaps the base was renamed and one contract was missed. The member is still discovered, still registered, still resolvable. What it is no longer is scoped: with no marker of its own and no group base to inherit from, its lifetime falls to the default, which is `singleton`.

Nothing announces this. The contract compiles, the manifest generates, the container starts. A unit that was per-request is now process-wide, and it is still holding a `uow`.

Two things catch it, and it is worth knowing which one you are relying on:

- **The inversion check is the net.** The moment the ungrouped unit becomes a singleton, its scoped dependencies become `singleton → scoped` edges, and generation fails. This is the safety net, and it is a good one — but it catches the *consequence*, so the error names a lifetime inversion rather than the group membership that actually changed.
- **The discovery report is the warning.** `ioc inspect --discovery` prints a line for a contract the previous generated manifest listed as a group member and this scan does not, precisely because that is the moment nobody would otherwise be told. It is one of the three cases that earn an individual line in the group rejection list rather than being collapsed into a count.

If a lifetime inversion appears in a package you did not think you had changed, check group membership first: `ioc explain <key> --discovery` prints the provenance chain, and a unit that has fallen off a group base says `singleton ← default` where it used to say `scoped ← group-base marker on WriteServiceBase`.

## Lifetime provenance

Every resolved lifetime carries a record of what decided it. The vocabulary is small, and it is the same in every place a lifetime is printed:

| provenance | means |
| --- | --- |
| `factory-config` | `registrations[Contract][impl].lifetime` in `ioc.config` — an explicit per-implementation override |
| `lifetime-marker` | a `lifetimeMarkers` interface on the unit's own contract site |
| `group-base-marker` | a marker on the base type of a group this contract is a member of; the family declared it, not the member |
| `discovery-root` | a `discovery.scanDirs[].scope` covering the unit's file |
| `default` | nothing declared one — `singleton` |

Two commands render it.

`ioc inspect --discovery` puts it next to the lifetime on each discovered row, and **only when it is informative**: `default` is what a lifetime is when nothing decided it, so printing it on most rows of most reports is exactly what makes the one row saying `(group-base-marker)` stop standing out.

```
✔ buildOrderWriteService → OrderWriteService  key: orderWriteService  scoped (group-base-marker)
✔ buildClock             → Clock              key: clock              singleton
```

`ioc explain <key> --discovery` renders it as a chain, in the direction of causation, ending at the thing to go and open:

```
Lifetime: scoped ← group-base marker on WriteServiceBase (RequestScopeLifeCycle) ← member of group "writeServices"
```

Manifests carry it too. A generated manifest records `lifetimeSource` next to each unit's `lifetime`, so `ioc explain <key>` without `--discovery` renders the chain as well — and, in a composing app, renders it for a unit supplied by a **composed package**, which is exactly the unit whose sources you cannot go and open. The manifest chain is one step thinner than the scan's: the marker's *name* is a fact about sources the manifest mode never read, so it prints `scoped ← lifetime-marker ← on the contract site of buildUow` where `--discovery` prints the marker interface too.

A manifest generated before the field existed carries no provenance, and that absence is readable rather than guessed at — `IOC_MANIFEST_FEATURES` declares whether the file records it. When a composed package's manifest predates it, `explain` prints the lifetime with the remedy instead of a chain:

```
Lifetime: singleton ← provenance not recorded — regenerate @packages/media-core with a current version
```
