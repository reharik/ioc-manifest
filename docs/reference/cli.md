# CLI: `ioc`

## The command map

`ioc` with no arguments, and `ioc --help`, print this. It is the same list, in the same order and the same words, that the tool prints for itself — the composite spellings get their own rows because they are the ones nobody remembers.

```
ioc — convention-based DI for TypeScript: discovery, generation, verification

  generate                    scan, verify, and write the manifest + registry types (the main verb)
  validate                    run the same checks against committed artifacts, without regenerating
  inspect                     what registered under which keys, and why
  inspect --discovery         what was found, what was skipped and why, group membership
  inspect --contract <name>   the same, narrowed to one name — the drill-down for a collapsed report
  explain <key>               one unit: lifetime + provenance, deps, dependents, which scopes reach it
  explain <key> --discovery   the same, re-read from source, so scope-root subtree reach is included

  ioc <command> --help        that command's flags, in detail
  --json                      (inspect, explain, validate) the same report, machine-readable
  IOC_DEBUG=1                 env var: stack traces alongside messages
```

`discovery` is **not** a verb — it is `inspect --discovery`. Nor are `check`, `gen`, `info` or `describe` verbs; type one anyway and the CLI names the spelling that works:

```
$ ioc discovery
Unknown command "discovery". Did you mean `ioc inspect --discovery`?
  Run `ioc --help` for the full command list.
```

Typos are answered the same way (`vaildate` → `validate`), and an unknown flag is answered against the flags the verb it followed actually takes. A word close to nothing is not guessed at: the map pointer stands alone rather than inventing a suggestion.

`ioc <command> --help` prints that command's row, its composites, and every flag it takes with a line each.

## Flags

| Flag                       | Purpose                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `--discovery`              | (inspect, explain) Re-run discovery and planning; don't read the generated manifest      |
| `--verbose`                | (inspect) Also show not-a-candidate rows and every group rejection, both collapsed by default |
| `--contract SUBSTRING`     | (inspect only) Narrow rows to a contract or export name, case-insensitively              |
| `--json`                   | (inspect, explain, validate) Emit the full report as JSON                                |
| `--config PATH`, `-c PATH` | Explicit path to `ioc.config.ts`                                                        |
| `--project PATH`           | Project directory for config resolution (default: cwd)                                  |

Set `IOC_DEBUG=1` for full stack traces on errors.

### Two worlds: the staleness banner

`ioc generate` describes your **sources**. When it finds a hard error it refuses to write anything, so the files in your generated directory stay exactly as the last successful run left them.

`ioc validate`, `ioc inspect` and `ioc explain` describe **those files**. Both are correct — about different moments. When they disagree, that gap is the reason.

So a failing generation leaves a marker, `.ioc-generation-state.json`, beside (never inside) the generated directory, and the three artifact-reading verbs banner their output while it is there:

```
[stale] Generated artifacts are STALE: the last generation attempt failed and wrote nothing.
        last attempt:  3 minutes ago (2026-08-23T11:00:00.000Z), 1 error
        Results below describe the LAST SUCCESSFUL generation, not the current sources.
        Run `ioc generate` to see what the sources say now.
```

The banner goes to stderr, so piping a report into a file or another tool still gets only the report. A successful generation **replaces** the marker with a success record in the same step that publishes the artifacts, so the banner disappears the moment it stops being true — and the record it leaves behind is what powers the freshness check below.

The marker records the outcome, a timestamp, how many offenders the failing attempt reported, and a fingerprint of the resolved inputs. The fingerprint is presence-and-mismatch data for the banner and nothing more — it cannot say *what* changed and does not try.

**Recommended `.gitignore` entry**, since it is local, timestamped tooling state:

```gitignore
**/.ioc-generation-state.json
```

It is harmless if committed. CI running `ioc validate` against a committed marker and printing the banner is working as intended: that tree genuinely has a failing generation.

With `--json` the marker is a `staleness` field carrying the same record, never a banner in the payload. `inspect` and `explain` gain the field alongside what they already emit.

### The other half: artifacts that may predate their sources

The staleness banner covers a generation that **failed**. The commoner mistake is the one where nothing fails at all:

> Edit a library's source. Forget the regenerate/rebuild ordering. Run `ioc validate` in the app — and read a confidently-worded finding that describes the world as it was before the edit.

Every generation records the fingerprint of its inputs. `ioc validate` recomputes that fingerprint for **this package and every composed package**, app-mode `ioc generate` recomputes it for the composed packages it reads, and `ioc inspect` / `ioc explain` recompute it for this package. A mismatch is reported twice — once at the top, and once on each finding that rests on the package in question:

```
⚠ @packages/media-core's generated artifacts may predate its sources (generated 12 minutes ago;
  sources have changed since). Findings involving its keys may describe the old world — regenerate
  there first.

[externals] Unsatisfied: "s3MediaSink" is a member of composed group "mediaSinks" and has no individual cradle key.
  note: @packages/media-core may be stale; this finding may describe the old world
  …
```

The inline note is the one that matters. A banner at the top of a report is read by somebody reading from the top; the caveat on the finding reaches the developer who scrolled straight to the first error.

**It never changes an exit code.** `ioc validate` exists to check committed artifacts, and refusing to report on out-of-date ones would remove the verb's job at the moment somebody needs it. The signal is a heuristic besides — so it warns loudly and always proceeds. (No `--strict-freshness` today; if CI users want one, it is a small addition on top of this.)

**What "matches" means, exactly.** The fingerprint is a sha256 over the config's source text plus `relativePath:sha256(content)` for every scanned file. Any byte changed in any scanned file, and any file added or removed, mismatches. It does **not** cover types imported from outside your `discovery.scanDirs` — a sibling package's `.d.ts`, a type from `node_modules` — which can change generation's output without moving the hash. So a match says *the scanned sources and the config are byte-identical to what generation saw*, and the wording never claims more than "may predate". Cost is proportional to the scan set: a fraction of a millisecond for a small package, and about 19 ms over a 480-file, 2.4 MB tree.

**When both are behind**, the banner names the dependency order:

```
⚠ @packages/media-core's generated artifacts may predate its sources …
⚠ this app's generated artifacts may predate its sources …
  Regenerate @packages/media-core before this app: this app's generation composes it, so
  regenerating here first would just bake the old output in.
```

**A package with no record** — artifacts generated before records were written, or a package that has never generated — gets one quiet line instead, not the banner:

```
note: no generation record for @packages/media-core — whether its artifacts predate its sources is unknown until it next generates.
```

Absence of evidence is not evidence, and it is reported at that volume deliberately.

### Breaking in 4.0: `ioc validate --json` emits an object

Through 3.x the document was the bare issue array. It is now an object:

```json
{
  "issues": [
    { "category": "externals", "severity": "error", "summary": "…", "details": ["…"], "suggestedFix": "…", "docUrl": "…" }
  ]
}
```

with `staleness` beside `issues` when the package's last generation attempt failed:

```json
{
  "staleness": { "outcome": "failed", "at": "2026-08-23T11:00:00.000Z", "errorCount": 1, "inputsHash": "sha256:…" },
  "issues": [ … ]
}
```

The envelope is the same shape either way — `staleness` is simply absent when generation last succeeded, matching how `inspect --json` and `explain --json` carry the same field. Consumers read `parsed.issues` unconditionally and never branch on the root type.

`freshness` sits beside it, one entry per package judged, local first:

```json
{
  "freshness": [
    { "name": "@apps/api", "outcome": "success", "generatedAt": "2026-08-23T11:00:00.000Z", "currentMatches": true },
    { "name": "@packages/media-core", "outcome": "success", "generatedAt": "2026-08-23T09:12:00.000Z", "currentMatches": false }
  ],
  "issues": [ … ]
}
```

`currentMatches` is **omitted**, never `false`, when nothing could be concluded — so a consumer gating on `currentMatches === false` is never handed an unknown. A package with no record carries `name` alone.

Per-issue field names are untouched: `category`, `severity`, `summary`, `details`, `suggestedFix`, `docUrl` — plus `possiblyStale: true` on any finding that resolves through a package whose artifacts may predate its sources. Migration is `JSON.parse(out)` → `JSON.parse(out).issues`.

## `ioc inspect`

`inspect --discovery` is the tool for "why isn't this registered?". It lists every scanned file with each export's outcome — discovered (with its contract and registration key) or skipped with a categorized reason, including the class-unit reasons such as `class_inherited_contract_not_declared` and `missing_return_type_annotation`. Unlike plain `inspect`, it re-runs discovery from source rather than reading the generated manifest, and it tolerates units that would abort a real generation so the report can list every offender at once.

### Group rejections are collapsed

The groups section of a report lists the candidates the membership pass considered and dropped. Membership is checked for every contract against every group, so in a package of any size almost all of those rejections say the same stock thing — `nominal_heritage_not_declared`, over and over, once per contract per group. A real consumer package with 91 units and 7 groups rendered about 2,000 lines of it.

A rejection gets its own line only when there is reason to think someone *wanted* that contract in that group:

- it satisfies the base's shape and simply never declared `extends` — the archetypal near-miss;
- the generated manifest on disk lists it as a member, so it is leaving the group in this run (see [the ungrouping cliff](/concepts/lifetimes#the-ungrouping-cliff));
- the reason is not the stock one — a type that could not be resolved or carries no named symbol, which means something is broken rather than merely absent.

Everything else collapses to one counted line per reason:

```
considered, rejected: 84 (nominal_heritage_not_declared) — use --contract <name> for a specific verdict
```

`--contract <name>` is the drill-down and prints the specific verdict for one name; `--verbose` prints the whole wall. `--json` is unaffected — it carries every rejection, each labelled with the `informative` flag the human screen acted on.

## `ioc explain <key>`

One cradle key, one screen, in the order the question is usually asked:

- **What it is.** A registration, a contract slot and the implementation it elects, a group root and its members, or a scope-root opener and the values it requires. An unknown key says so, offers the keys that look like it, and exits non-zero.
- **How long it lives, and who decided that.** The lifetime with its [provenance chain](/concepts/lifetimes#lifetime-provenance) — `scoped ← group-base marker on WriteServiceBase (RequestScopeLifeCycle) ← member of group "writeServices"`.
- **What it depends on.** Each demanded key with what it resolved to and its lifetime, and an inline advisory wherever the [floor rule](/concepts/lifetimes#the-floor-rule) is under pressure. Same severities the generation-time check assigns — this is a view of that rule, not a second opinion about it.
- **Who depends on it.** Every unit demanding the key, including through a group root or a contract slot, plus the scope-root subtrees that reach it.

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

It reads the generated manifest by default and re-runs discovery with `--discovery`. A manifest records no scope-root subtree, so manifest mode says so rather than guessing — `--discovery` is the mode with subtree reach. Lifetime provenance is available in both since manifests began carrying `lifetimeSource`; the manifest chain is one step thinner, because the marker's *name* is a fact about sources manifest mode never read. Both modes are read-only and parse the manifest rather than importing it. `--json` emits the same record.

### In an app: the composed picture

In a package with `composedManifests`, most cradle keys are supplied by somebody else — which is where the question gets asked most often and where a package-local answer is least useful. So in app mode `explain` answers over the **same merged picture** `ioc validate` and app-mode `ioc generate` read: the same slice loader, the same [default-election](/concepts/conventions#default-implementation-selection) helpers, the same group membership index. It cannot name an implementation behind a slot key that the composition suite would reject.

Every answer names its supplier package:

```
mediaStorage → contract slot for MediaStorage — resolves whichever implementation is elected
  ★ elected: s3Storage (@packages/media-core/src/factories/buildS3Storage.ts#buildS3Storage) of 2: localStorage, s3Storage
  supplied by @packages/media-core

Lifetime: singleton ← lifetime-marker ← on the contract site of buildS3Storage

Depends on:
  mediaClock  scoped  registration of MediaClock  from @packages/media-core
      ![lifetime-inversion] a singleton freezes its scoped dependency at first construction and reuses it across every scope

Demanded by:
  mediaIndexer (@packages/media-core/src/factories/buildMediaIndexer.ts)  in @packages/media-core
  uploadHandler (src/factories/buildUploadHandler.ts)  in @apps/api (this app)
```

Two answers exist only here, and both replace what used to be a bare miss:

**A grouped member's would-be key.** [Grouped means group-only](/concepts/groups#grouped-means-group-only): a grouped contract claims no cradle key, so nothing can supply one. That is the rule working, not drift, and `explain` states it as an answer — the teaching-register sibling of the `grouped-member-demand` error, with the spelling that does work. For a record group that is the record's **own property key**, which diverges from the registration key whenever an implementation is named differently from its contract:

```
trackWriteService → member of composed group "writeServices" — no individual cradle key
  group:     "writeServices"  (kind: object, base: WriteServiceBase, declared by @packages/media-core)
  contract:  "TrackWriteService"
  A grouped contract is consumed through its group and through nothing else …
  Consume it through the group: `writeServices: IocGroupWriteServices`, then `writeServices.trackWriteService`.
  → docs: https://reharik.github.io/ioc-manifest/concepts/groups#grouped-means-group-only
```

**An external.** Nothing in the composed manifests registers it because the app registers it on the root container before composing. `explain` describes the demand side honestly — the demanded type and every package expecting it — rather than reporting a key it could not find:

```
logger → external — supplied by the composing app at bootstrap
  demanded:    Logger
  demanded by: @apps/api (this app), @packages/media-core
```

Freshness travels with the answer. `explain` already banners this package's own [staleness](#the-other-half-artifacts-that-may-predate-their-sources); additionally, when the **supplier** of the explained key may predate its sources, the answer carries the same inline caveat a validate finding does:

```
note: @packages/media-core may be stale; this finding may describe the old world
```

If the composed picture cannot be read at all — an unresolvable composed package — `explain` says so on stderr and answers over this package alone. It is a view: a half-answer beats a refused question.

`--json` extends, never renames. The composed answer adds `supplier`, `packages` (the `sourceId`s the answer rests on), `possiblyStale` / `stalenessNote`, per-dependency and per-dependent `packageLabel`, and the `grouped-member` / `external` resolution kinds, alongside every field it has always emitted.

## `ioc generate` in app mode: the composition suite

**Everything gen can know, gen enforces; `validate` exists to run the same checks without regenerating.**

When `composedManifests` is set, `generate` does not only compose — it judges the composition. After emission inputs are resolved (election, groups, demand/supply, scope-root openers, the composed manifest source) and **before anything is written**, it runs the full composition suite: externals satisfaction with type comparison, the `registry-integrity` gate, cross-manifest `same-key-conflict` and group consistency, composed `default-ambiguity`, `schema-version`, and app-config sanity.

Failures are generation failures. One aggregated report names every offender in a single pass — never first-failure-wins — the process exits non-zero, and **no output is written**: nothing broken lands on disk, the same rule the import-closure invariant established. Severity matches `validate` exactly: what `validate` calls an error fails generation, what it calls a warning is printed and the run continues.

There is no flag to suppress the suite. A composition error is an error whichever verb finds it; the alternative path is to run `validate` without regenerating, not to generate without checking.

**Library mode is unchanged — no composition check runs there, and none is skipped.** The information does not exist. Every check in the suite adjudicates a relationship *between* manifests; a library has no composed set to relate to. Its `IocExternals` is a promise to whichever app composes it later, and that app's `generate` is the first run that can say whether the promise is kept.

## `ioc validate`

The composition suite **without regenerating**. Same checks, same module, same program construction — reading committed artifacts instead of pending ones. It does not modify any files.

Two things it answers that app-mode `generate` cannot:

- **CI over committed artifacts.** Prove the manifests in the repo compose, without writing files and without a diff to reconcile afterwards.
- **An app against a rebuilt dependency.** A library republished its manifest; does this app still compose against it? Answerable without touching the app's source or its generated output.

`validate` loads every composed manifest, runs every cross-manifest check at once, and reports all issues — not just the first. Exit code is non-zero if any error-severity issue is reported.

Issue categories, as they appear in text output and in the `category` field of `--json`: `registry-integrity`, `externals`, `schema-version`, `same-key-conflict`, `group-kind`, `group-base-type`, `group-key-conflict`, `default-ambiguity`, `slot-occupancy`, `app-config`, `unused-config`.

Both verbs build the **same program**: the app's own `tsconfig.json`, the app's full source set rooted, resolution as the app's own `tsc` performs it. Defaulting to the env is deliberate — a check that disagrees with the build it guards is worse than no check. Each physical file is admitted exactly once (a workspace package reached through its `node_modules` symlink and directly is one file, not two), and a guard hard-errors naming both paths if that is ever untrue: two `SourceFile`s for one file means two copies of every declaration in it, and a class with private members is not assignable to its own copy.

`registry-integrity` runs first and gates the type comparisons: if a generated registry-types file does not compile, the run says so and skips the comparisons that read types out of it, rather than adjudicating them against error types (which pass unconditionally). Comparisons whose types come only from healthy files still get their verdict. In `generate`, the skipped comparisons are part of the failure report — the run fails on the integrity error, and never reads as coverage it did not have.

`externals` reads each package's `IocGeneratedCradle` as the supply side, and that includes **contract slot keys** — the camel-cased contract name (or configured `accessKey`) a contract's elected default answers to. A demand for a contract key is therefore satisfied by whichever package elects a default for that contract, exactly as a demand for a registration key is satisfied by whichever package registers it. An ungrouped contract that elects no default has no slot key, so a demand for the name reports `Unsatisfied` like any other unregistered key; `default-ambiguity` names the contracts in that state.

`slot-occupancy` reports an implementation registered under its contract's slot key while some *other* implementation is elected — the shape composition can create out of two packages that are each fine alone (a library registering and electing `mediaStorage`, an app electing `s3MediaStorage` over it). The slot key means "the elected default"; a registration owning that name makes it mean something else. `ioc generate` gates the package-local version of the same rule off its registration plan, in library and app mode alike, so this category is about what only the composed view can see.

`default-ambiguity` **skips grouped contracts entirely**. Grouped ⇒ group-only: a grouped contract backs no default slot, so several implementations with no `default: true` is its ordinary, correct shape and there is nothing for a default to be ambiguous about. Grouping is read off the group roots each manifest carries, so it holds across the composed set.

Typical output for a failing run:

```
[app-config] registrations references unknown contract "Storge"
  Known local contracts: Logger.
  Known composed contracts: Logger, LoggingService, Storage, UploadService.
  Did you mean: "Storage"?
  Suggested fix: Fix the contract name in ioc.config.ts registrations, or add a factory for "Storge".
  → docs: https://reharik.github.io/ioc-manifest/config/reference#registrations

Validation failed: 1 error, 0 warnings.
```

Library-mode invocations print an informational message and exit 0 — there's nothing cross-manifest to validate.

Recommended workflow: `ioc generate` → `tsc --noEmit` → deploy. In app mode `generate` has already run the suite, so `ioc validate` is for the cases above — a CI job over committed artifacts, or checking this app against a dependency someone else rebuilt.

---
