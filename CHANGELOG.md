# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-05-23

### Changed

- Codegen no longer prints TypeScript diagnostics on every run when discovery files have compile errors. Compiler errors in scan targets are shown only when generation fails for a type-checking-related reason (for example, a file missing from the program, unresolvable factory deps types, or conflicting demanded key types).

## [2.0.0] - 2026-05-22

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
