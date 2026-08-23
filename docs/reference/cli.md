# CLI: `ioc`

```bash
npx ioc                       # prints help
npx ioc generate              # discover units, emit manifest + types (and ioc-composed.ts in app mode)
npx ioc generate -c ./ioc.config.test.ts   # generate with a specific config
npx ioc inspect               # loads the generated manifest and prints a summary
npx ioc inspect --discovery   # re-runs discovery without reading the manifest
npx ioc explain uow           # one key: what it resolves to, its lifetime, its deps, its dependents
npx ioc explain uow --discovery   # …with lifetime provenance and scope-root subtree reach
npx ioc validate              # the composition suite without regenerating (app mode)
npx ioc validate --json       # machine-readable issue list
```

| Flag                       | Purpose                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `--discovery`              | (inspect, explain) Re-run discovery and planning; don't read the generated manifest      |
| `--verbose`                | (inspect) Also show not-a-candidate rows and every group rejection, both collapsed by default |
| `--contract SUBSTRING`     | (inspect only) Narrow rows to a contract or export name, case-insensitively              |
| `--json`                   | (inspect, explain, validate) Emit the full report as JSON                                |
| `--config PATH`, `-c PATH` | Explicit path to `ioc.config.ts`                                                        |
| `--project PATH`           | Project directory for config resolution (default: cwd)                                  |

Set `IOC_DEBUG=1` for full stack traces on errors.

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

It reads the generated manifest by default and re-runs discovery with `--discovery`. The manifest records the lifetime it resolved but not the reasoning that produced it, and no scope-root subtree, so manifest mode says so rather than guessing — `--discovery` is the mode with provenance and subtree reach. Both modes are read-only and parse the manifest rather than importing it. `--json` emits the same record.

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
