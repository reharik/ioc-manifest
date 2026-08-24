# Adopting on an existing codebase

`ioc generate` is the verb. You point it at your source, run it, and it tells you what your codebase is — not what it should be. On an existing codebase of any size the first run is red, and that is the tool working: every error names a place where what you wrote and what you meant are two different things, and until now nothing was reading closely enough to notice.

So the skill worth having early is not "how do I make it green" but **how to read a red run**. This page is that, written from a two-app migration. Each section links to the chapter that owns the rule rather than restating it; if you have not read [How it fits together](/guide/how-it-fits-together), read that first.

## Point discovery, then read the footer

Start by pointing `discovery.scanDirs` at the directories that hold your units and running `ioc inspect --discovery`. The report lists every scanned file and every export's outcome, and it ends with two lines:

```
Summary: 214 file(s) scanned · 91 unit(s) discovered · 3 near-miss(es) · 74 not-a-candidate file(s)
         12 file(s) excluded by config
```

**The second line is a heartbeat, and you should treat it as one.** An excluded file never enters the scan set, so nothing records an outcome for it — there is no skip row, no near-miss, no warning. That count is the only evidence it exists. `--verbose` and `--json` name the files.

The rule that follows: **after any edit to `excludes`, check the delta.** If the number moved more than you meant it to, find out what else it took.

::: warning The war story
An exclusion was added to keep domain entity classes out of the scan — they carry `implements` clauses, and they are not registration units. The glob was written against the directory those entities live in.

It also matched one file in that directory that was not an entity: the factory supplying `idGenerator`.

Nothing said so. The supplier simply stopped being discovered, and the failure surfaced three scope roots away, as `lbv_missing_key` on `idGenerator` under `openAuthRouterScope` — a unit deep inside the request subtree demanding a key that, as far as the walk could tell, nothing supplied. The error's suggested fix was to add `idGenerator` to the boundary's late-bound-value declaration. That fix compiles. It is also completely wrong: it would have made every call site pass an id generator by hand, forever, to work around a glob.

**When a key that used to resolve goes missing, check that its supplier is still discovered before believing anything downstream.** A missing supplier and a genuinely late-bound value are indistinguishable at the demand site — the walk only knows the key is unsupplied — so the demand-site error cannot tell you which one you have. `ioc inspect --discovery` can, in one line. The [scope-roots troubleshooting section](/concepts/scope-roots#troubleshooting) has the check order.
:::

## Names carry meaning

Once discovery sees your files, the next surprise is that the names you already chose are now load-bearing.

A factory named after its contract — `buildMediaStorage` for `MediaStorage` — registers under `mediaStorage`, which is also that contract's **slot key**: the name the contract's *elected default* answers to. A factory named anything else — `buildS3MediaStorage` — registers under an implementation key of its own, `s3MediaStorage`, and a consumer that wants specifically that one must say so with `Named<MediaStorage>`. A consumer that wants whichever one is elected demands the slot, `mediaStorage: MediaStorage`, and follows the election forever after with no source edit.

That gives you the **slot-shadow rule**: a registration may occupy its contract's slot key only if it is the electee. If `buildMediaStorage` owns `mediaStorage` while `ioc.config` elects `s3MediaStorage`, the name says one thing and the election says another, and every consumer writing the contract key has silently been getting the occupant. Generation refuses it, and names both exits — rename the factory so it registers under a key of its own, or elect the occupant. Renaming is usually what was meant.

Two divergence signals in the discovery report are worth knowing on the way in:

- **A class whose file name would have keyed differently under Awilix `loadModules`.** `storage.ts` exporting `S3MediaStorage` registers as `s3MediaStorage`, not `storage`, because the key comes from the class name. If you are migrating off `loadModules`, this is the report telling you which container keys are about to move.
- **A near-miss row.** An export that matched a trigger and could not be registered gets a categorized reason — a missing return type annotation, a contract site that is not a named type, a class inheriting a contract it does not restate. Near-misses are the worklist; not-a-candidate files are noise and are collapsed by default.

→ [Registration keys](/concepts/conventions#registration-keys) · [Contract slot keys](/concepts/conventions#contract-slot-keys) · [The demand model](/concepts/conventions#demanding-a-dependency-the-five-things-a-deps-property-can-be)

## Groups are declared, and consumed whole

Membership in a group is **nominal**: the member's contract must declare heritage to the group's base type. `extends` is the usual spelling, including the empty-interface form:

```ts
export interface EmailChannel extends NotificationChannel {}
```

An intersection (`type EmailChannel = Something & NotificationChannel`) and a plain alias (`type EmailChannel = NotificationChannel`) count too. A **union** does not — `type EmailChannel = NotificationChannel | undefined` joins nothing, which is the most common silent miss.

::: tip The lint-autofix trap, and what is left of it
Through v2, a lint rule that rewrote `interface Foo extends Base {}` into `type Foo = Base` — several do this unprompted — silently dropped the contract out of its group, because a plain alias collapsed into its target. That is fixed: both forms now denote the same contract and both confer heritage, so the autofix is a no-op on behavior and you may prefer whichever you like.

What survives is narrower and still worth a lint exception: any rewrite that turns the heritage into a **union** breaks membership, because a union is not heritage.
:::

Then the rule that reshapes consumers: **grouped means group-only.** A contract in a group has no contract key at all — not "unelected", categorically none, even with a single implementation — and its implementations have no individual cradle keys. All four ways of asking for one member are the same error with the same guidance, and the one way in is the group:

```ts
type Deps = { notificationChannels: NotificationChannels };
//   …then notificationChannels.emailChannel, for a record group.
```

For a record (`kind: "object"`) group, each member is a property of the group value keyed by **its contract-derived key** — `emailChannel` for `EmailChannel` — so keyed access survives grouping; what does not survive is naming the member in a deps type.

**When you read the member is the part to get right**, and it is the only thing a member-to-sibling dependency asks of you. Resolving a group resolves no members: the group value is inert, and each slot resolves the first time it is read.

```ts
// Destructuring the group at construction: fine, for a member or anything else.
// You are taking the inert object; nothing is built.
export const buildAddComment = ({ writeServices }: AddCommentDeps): AddComment => ({
  // Reading a member at CALL time: the recommended member-consumer form.
  add: (body) => writeServices.toggleReaction.react(body),
});

// Reading a member PROPERTY at construction: builds it right there.
export const buildAddComment = ({ writeServices }: AddCommentDeps): AddComment => {
  const toggle = writeServices.toggleReaction; // ← resolves now
  return { add: (body) => toggle.react(body) };
};
```

The last form is not banned — it is what any non-member consumer does, and it is fine when the member it reaches does not lead back. Inside a member it usually does lead back, and then you get a cyclic-dependency error naming the group hop and the read. The fix is always the same: move the read into the function you return.

The one other thing to know is that the slots are getters, so spreading or `Object.values`-ing a group value reads every slot and resolves every member. Legal, occasionally what you want, never what you want inside a member. Hold the group; read what you need.

**The ungrouping cliff** is the one to watch during a refactor. Lifetime for a grouped contract is declared once on the base, and every member inherits it. When a member stops declaring heritage — a renamed base, a contract missed in a sweep — it is still discovered, still registered, still resolvable, and no longer scoped: with no marker of its own and no base to inherit from, its lifetime falls to the default, `singleton`.

Nothing announces that directly. Two things catch it, and it matters which one you are relying on:

- **The inversion errors are the net.** The moment the ungrouped unit becomes a singleton, its scoped dependencies become `singleton → scoped` edges and generation fails — but the error names a lifetime inversion, which is the consequence, not the membership change that caused it.
- **The discovery report is the warning.** A contract the previous generated manifest listed as a member and this scan does not gets its own line — `was a member in the generated manifest; this scan drops it` — precisely because that is the moment nobody would otherwise be told. It is one of the few rejections that escapes the collapsed tally.

If an inversion error appears in a package you did not think you had changed, check group membership first.

→ [Groups](/concepts/groups) · [The ungrouping cliff](/concepts/lifetimes#the-ungrouping-cliff)

## Lifetimes: the floor rule

One sentence decides every lifetime question you will have during adoption:

> **A unit lives at most as long as its shortest-lived dependency.**

You do not work out a unit's lifetime by looking at the unit. You look at what it demands. This is why the argument that arrives in every migration — "why can't my repository be a singleton, it has no state" — resolves the way it does: the repository takes a `uow`, a unit of work is one per request, so the repository is per-request, and so is the write service holding it, and the handler holding that. The read tree, which takes no `uow`, is under no such constraint, and that asymmetry is normal.

`ioc explain <key> --discovery` prints the answer directly: the resolved lifetime with its **provenance chain** — what decided it, and where that declaration lives — and every dependency with its own lifetime beside it.

```
Lifetime: scoped ← group-base marker on WriteServiceBase (RequestScopeLifeCycle) ← member of group "writeServices"
```

That chain is the fastest route from "why is this scoped" to the file to open. It is also how you tell an ungrouping cliff from a genuine change: a unit that has fallen off its group base says `singleton ← default` where it used to name the base.

→ [Lifetimes](/concepts/lifetimes) · [The floor rule](/concepts/lifetimes#the-floor-rule) · [Lifetime provenance](/concepts/lifetimes#lifetime-provenance)

## Foreign types need local names

Contract identity is the name written at the contract site, resolved to the declaration it names. A package that exposes its type only as a **default export** or through `export =` — the shape a good many `@types` packages and CommonJS typings still have, the router case being the one everybody hits — has no name to resolve to. The declaration's exported name is literally `default`, and there is no such thing as importing that:

```ts
import Router from "vendor-router";

export const buildAppRouter = (deps: AppRouterDeps): Router => makeRouter(deps);
```

Generation refuses this at the contract site, and names the factory, the annotation, and the module it came from:

```
[ioc] 1 contract site names a type that has no importable name of its own. …

  - [contract_annotation_default_export] Annotates `Router`, which "vendor-router" publishes only as its default export.
      factory:      "buildAppRouter"
      site:         src/http/appRouter.ts:14
      annotates:    Router
      module:       "vendor-router"
      resolves to:  "default" — the export name, not a binding
      Wrap it locally and annotate with the wrapper: …
```

What is left at the site when the name is stripped away is `Router` — your local alias, a fact about *your* file rather than about the contract. Two files importing the same foreign type under two aliases would declare two different contracts, and neither name is one the generated registry file could import. So the tool asks for a name instead of inventing one.

Give the foreign type a local name once, and use that name at every deps position and every return position:

```ts
// src/types/appRouter.ts
import type Router from "vendor-router";

export interface AppRouter extends Router {}
```

```ts
import type { AppRouter } from "../types/appRouter.js";

export const buildAppRouter = (deps: AppRouterDeps): AppRouter => makeRouter(deps);
```

The empty extending interface is the whole fix — it is a named declaration in a file of yours, which is all contract identity ever asked for. Do it once per foreign type, not once per factory: two different local names for the same foreign type are two different contracts.

The same rule catches the same shape at home. A declaration of yours published as `export default class Router {}` is exported under the name `default` exactly as a package's is, and the refusal prescribes the smaller edit there: drop `default` and export it by name.

→ [Contract identity](/concepts/conventions#contract-identity) · [Pitfalls](/reference/pitfalls)

## Two worlds when gen is red

The last thing to internalise, because it will otherwise cost you an afternoon.

`ioc generate` describes your **sources**. When it finds a hard error it refuses to write anything — so the files in your generated directory still describe the last run that succeeded, which during an adoption may be hours and several hundred edits ago. `ioc validate`, `ioc inspect` and `ioc explain` read **those files**. Both are telling the truth, about different moments.

A failing generation leaves a marker beside the generated directory, and the three artifact-reading verbs banner their output while it is there:

```
[stale] Generated artifacts are STALE: the last generation attempt failed and wrote nothing.
        Results below describe the LAST SUCCESSFUL generation, not the current sources.
```

The working rule: **trust `generate` about your sources, and the banner about your artifacts.** When a `validate` report and a `gen` report disagree, that gap is not a bug in either; it is the distance you have travelled since the last green run. Re-run `gen` before believing anything the other three say.

The banner goes to stderr, so piping a report into a file or another tool still gets only the report, and `--json` carries the same record as a `staleness` field instead. Add `**/.ioc-generation-state.json` to `.gitignore` — it is local, timestamped tooling state.

The commoner version of the same confusion has nothing failing at all: you edit a library, forget the regenerate/rebuild ordering, and the app's `validate` reports the old world with total confidence. Every generation records a fingerprint of its inputs, so the artifact-reading verbs can now say when a package's output may predate its sources:

```
⚠ @packages/media-core's generated artifacts may predate its sources (generated 12 minutes ago;
  sources have changed since). Findings involving its keys may describe the old world — regenerate
  there first.
```

Findings that rest on that package carry the same caveat inline. It never fails a build.

→ [Two worlds: the staleness banner](/reference/cli#two-worlds-the-staleness-banner) · [Artifacts that may predate their sources](/reference/cli#the-other-half-artifacts-that-may-predate-their-sources)

## When it goes green

Run `ioc generate` → `tsc --noEmit`. In app mode, `generate` has already run the full composition suite, so a green run means the composed picture holds too — [`ioc validate`](/reference/cli#ioc-validate) is for CI over committed artifacts and for checking this app against a dependency somebody else rebuilt.
