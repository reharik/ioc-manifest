# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
