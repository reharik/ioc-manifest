# CLI: `ioc`

```bash
npx ioc                       # prints help
npx ioc generate              # discover units, emit manifest + types (and ioc-composed.ts in app mode)
npx ioc generate -c ./ioc.config.test.ts   # generate with a specific config
npx ioc inspect               # loads the generated manifest and prints a summary
npx ioc inspect --discovery   # re-runs discovery without reading the manifest
npx ioc validate              # the composition suite without regenerating (app mode)
npx ioc validate --json       # machine-readable issue list
```

| Flag                       | Purpose                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `--discovery`              | (inspect only) Re-run discovery and planning; don't read the generated manifest         |
| `--json`                   | (validate only) Emit issues as JSON                                                     |
| `--config PATH`, `-c PATH` | Explicit path to `ioc.config.ts`                                                        |
| `--project PATH`           | Project directory for config resolution (default: cwd)                                  |

Set `IOC_DEBUG=1` for full stack traces on errors.

`inspect --discovery` is the tool for "why isn't this registered?". It lists every scanned file with each export's outcome — discovered (with its contract and registration key) or skipped with a categorized reason, including the class-unit reasons such as `class_inherited_contract_not_declared` and `missing_return_type_annotation`. Unlike plain `inspect`, it re-runs discovery from source rather than reading the generated manifest, and it tolerates units that would abort a real generation so the report can list every offender at once.

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

Validation failed: 1 error, 0 warnings.
```

Library-mode invocations print an informational message and exit 0 — there's nothing cross-manifest to validate.

Recommended workflow: `ioc generate` → `tsc --noEmit` → deploy. In app mode `generate` has already run the suite, so `ioc validate` is for the cases above — a CI job over committed artifacts, or checking this app against a dependency someone else rebuilt.

---
