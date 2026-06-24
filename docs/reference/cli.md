# CLI: `ioc`

```bash
npx ioc                       # prints help
npx ioc generate              # discover factories, emit manifest + types (and ioc-composed.ts in app mode)
npx ioc generate -c ./ioc.config.test.ts   # generate with a specific config
npx ioc inspect               # loads the generated manifest and prints a summary
npx ioc inspect --discovery   # re-runs discovery without reading the manifest
npx ioc validate              # app mode: cross-manifest checks against composedManifests
npx ioc validate --json       # machine-readable issue list
```

| Flag                       | Purpose                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `--discovery`              | (inspect only) Re-run factory discovery and planning; don't read the generated manifest |
| `--json`                   | (validate only) Emit issues as JSON                                                     |
| `--config PATH`, `-c PATH` | Explicit path to `ioc.config.ts`                                                        |
| `--project PATH`           | Project directory for config resolution (default: cwd)                                  |

Set `IOC_DEBUG=1` for full stack traces on errors.

## `ioc validate`

A separate command from `generate` because they have different audiences. `generate` runs frequently during development and shouldn't fail on transient inconsistencies (a sibling package mid-refactor). `validate` is the pre-merge / pre-deploy gate.

`validate` loads every composed manifest, runs every cross-manifest check at once, and reports all issues — not just the first. It does not modify any files; pure inspection. Exit code is non-zero if any error-severity issue is reported.

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

Recommended workflow: `ioc generate` → `ioc validate` → `tsc --noEmit` → deploy.

---
