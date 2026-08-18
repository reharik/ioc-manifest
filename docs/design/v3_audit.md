# v3 Audit: Rewrite vs. Stabilize vs. Retrofit

**Status:** Decided — retrofit. Stage 0 ships on main as v2.6.0; stages 1–4 land on a `v3` branch gated by a golden-manifest diff against the consuming monorepo.

**Date:** August 2026 (against v2.5.0)

## Purpose and method

The library has evolved through bug-driven accretion since 1.0.0. This audit asks whether a simpler design could provide the same functionality, using a four-step process designed to defeat the standard rewrite trap: greenfield designs look simpler because they haven't met the edge cases yet. Any candidate redesign is therefore charged against the full invariants ledger (step 2) before its simplicity is scored.

1. Enumerate the actual public API surface from source.
2. Extract every hard-won invariant from the changelog and history, tagged Essential (any design pays it) vs. Architectural (artifact of a specific design commitment).
3. Sketch alternatives that relax the commitments generating the Architectural invariants.
4. Compare against the bar: a change must be _significantly_ better than stabilizing in place.

## Step 1 — API surface

The essential surface is small: config in (`ioc.config.ts`), two generated files out (`ioc-manifest.ts`, `ioc-registry.types.ts`, plus `ioc-composed.ts` in app mode), one runtime call (`registerIocFromManifest`), three CLI commands (`generate`, `inspect`, `validate`). The ~60 barrel exports beyond that are internal plumbing made public.

Code mass concentrates in the generator layer: roughly 51% of source LOC, dominated by `writeManifest`, `resolveRegistrationPlan`, `emitTypeReference`, and the `analyzeDemandSupply` family. The runtime consumers actually execute is thin. This concentration is the deciding observation: complexity lives in compiler-API analysis, not in the design's shape.

## Step 2 — Invariants ledger (37)

Tagged **[E]** essential-to-domain or **[A]** artifact-of-a-design-commitment.

### A. Type-identity semantics — [A], artifact of "contracts inferred from return-type symbols"

1. Contract identity is the return type's symbol name; structural equivalence is irrelevant.
2. Plain type aliases collapse through `getApparentType` — only `interface X extends Base {}` or member-adding intersections create distinct contracts.
3. Group/marker membership is nominal (`extends`/`&` heritage), never structural (v1.1.x over-matching).
4. Heritage walking follows aliased symbols through imports/type aliases (1.2.1).
5. Bare-union return types are undiscoverable — skip loudly (2.5.0).
6. Generic instantiations preserved in emitted types; un-instantiated type param reaching the cradle is a hard fail (2.1.0).
7. Type-arg emission clamps to the printed name's arity (2.2.0).
8. Cross-manifest group identity = canonical `<abs-path>:<TypeName>`; diamond hoisting via `groupBaseTypeAliases` (1.0.0).

### B. Cold-start / self-reference — [A], artifact of "generated types consumed back by scanned source"

9. The generator never type-checks its own prior output — consumed generated references resolve syntactically against the in-memory manifest (1.4.2, 2.3.3).
10. Aliased imports of generated names resolve via import-binding AST, not symbol resolution.
11. The generated file never imports itself; locally-declared names stripped from import buckets; path comparisons absolute + symlink-resolved (2.3.1, 2.3.2).
12. Unknown consumed cradle key = hard fail naming the key (1.4.2).

### C. Import/specifier fidelity — [E] for any TS-emitting codegen

13. Preserve bare package specifiers; never emit deep relative paths across package boundaries; warn on imports escaping the package root (1.1.2).
14. `.js`-suffixed export paths map to on-disk `.ts`/`.mts`/`.cts` (1.1.5).
15. Honor tsconfig `customConditions`; never fall back to the `types` condition for value loading (1.1.3).
16. Anonymous intersection members inline structurally; same-file deps property types get real imports (2.3.4, 1.1.4).

### D. Composition semantics — [E]

17. Externals satisfaction: supplied `extends` demanded, per-key `Pick`-indexed assertions (1.4.1, 1.4.0).
18. `scopeProvided` keys excluded from externals; built-and-scope-provided is a hard error; undemanded declaration warns (1.3.0).
19. Manifest schema version checked at composition; mismatches refused.
20. Same-key conflicts resolved via `source`; conflicting defaults, group kind/base mismatches, object-group key collisions each get dedicated errors.

### E. Generator/runtime parity — [A], artifact of the split generator + manifest + runtime shape

21. Any generator-computed policy is in the manifest or re-derivable at runtime (2.3.5 boot abort was divergence).
22. Group roots are transient wrappers; members keep their own lifetimes (2.0.0).
23. Default election precedence: app override → manifest default → single-impl/convention fallback.
24. Group-only base with no elected default emits no singular cradle key (2.3.0).

### F. Lifetime discipline — [E]

25. Per-edge inversion detection: singleton→scoped errors, →transient warns, findings aggregate (1.5.0).
26. `allowLifetimeInversion: boolean | string[]`, config-only.
27. Precedence: per-impl override → lifetime markers → scan-root scope → default.

### G. Config loading — [E]

28. Every key whitelisted _and_ shape-validated (2.2.1, 2.3.6 were whitelist omissions); malformed values never silently no-op.
29. TS config loads via in-process transpile, tolerant of ESM and `mod.default.default` CJS-interop shapes (2.3.6).
30. Discovery never executes factory source — AST only.

### H. Fail-loud philosophy — [E]

31. Empty group fails generation unless `allowEmpty` (2.5.0).
32. Prefix-matched-but-unregisterable factories warn with categorized reasons (2.5.0).
33. Divergent single-impl naming warns unless suppressed (2.4.0).
34. Errors aggregate before throwing.

### I. DX contracts — [E]-ish, renegotiable

35. Group aliases emit as PascalCase `export type` with collision guard (2.1.0).
36. Factory sites use named local deps types.
37. Per-package scan only; cross-package reach is composition.

### The read

Classes A and B — 12 of 37 invariants and the majority of post-1.0 patch releases — trace to exactly two design commitments: contracts inferred from return-type symbols, and generated types consumed back by scanned source. The [E] classes are domain cost any design pays; the bug density is not there.

## Step 3 — Sketches

**S2: Annotation identity (relaxes A).** Contract identity = the return type annotation's written name + import binding, resolved syntactically. Checker demoted from identity-source to verifier (membership assignability, externals). Invariants 1, 2, 5 cease to be possible states: plain aliases and named union-arm aliases become first-class contracts; the empty-extends requirement and the lint-autofix trap (empty interface → alias conversion silently breaking discovery) disappear. Nominal membership (3–4) and generic emission (6–7) survive deliberately. New invariant in trade: annotation required; missing annotation is a categorized discovery error. Migration cost: factories currently relying on inferred returns need one annotation each — enumerated automatically by the new error on first run.

**S1/B: Closing the generated-consumption loop (relaxes B).** Three variants were considered for group-type consumption at factory sites:

- B1 (ban factory-side imports entirely): structurally closed but removes the same-package group consumption feature — rejected.
- B2 (user-authored aliases, e.g. `export type Channels = ReadonlyArray<Channel>`): closed by construction; one authored line per collection group; object groups fall back to subset demand at factory sites. Rejected as primary because keyed-group ergonomics matter here, but remains the fallback if enumeration closure ever fails.
- **B3 (chosen): closure by enumeration.** TS has a finite set of forms for referencing a module's types: named import, aliased import, namespace import, indexed access on those, `typeof import(...)`, re-export. The existing interception machinery (1.4.2, 2.3.3) handles the first four. The last two are unhandled today — re-export of generated names through a barrel is a live cold-start/poisoning hole. B3 adds hard errors for both, declares the enumeration complete, and keeps the feature with zero consumer change.

**Pruned:** wrapper-factory `factory<T>(fn)` (touches every factory, runtime footprint, no extra power while codegen exists); runtime discovery (deletes the product); JSON manifest (loses static, bundler-friendly, type-checked module imports); greenfield rewrite (re-pays every [E] invariant to obtain what a retrofit gets).

## Step 4 — Verdict

**Retrofit, not rewrite; the candidate clears the "significantly better" bar conditional on the adoption ambition being real.**

Candidate: S2 + B3 + class-unit support + manifest schema v3. What it buys: permanent closure of the two dominant bug classes; deletion (not fixing) of the top documented pitfalls; class support implemented on the mechanism suited to it; an invariants ledger that trades subtle checker semantics for mechanical syntactic rules. Net LOC roughly flat (~900–1,500 generator LOC retired, class discovery added); the win is bug-class closure, not size.

What it costs: five staged implementation sessions; risk concentrated entirely in discovery, gated by a golden-manifest diff (regenerate the consuming monorepo before/after; diff must be empty modulo intended changes). Emission, composition, validate, lifetime layers untouched. v3.0 breakage is free at current adoption.

Stabilize-in-place, scored honestly: still pays stage 0 (the re-export hole is live), still owes class support later on worse foundations, keeps the adoption-ceiling warts permanently.

## Class support and Awilix positioning

Class units are the second independent argument for annotation identity: a factory's return annotation and a class's `implements` clause are the same thing — a declared contract site, named, syntactic, readable without the checker. One identity rule, two unit kinds. Deps analysis (single object constructor param), nominal group membership, and camelCase key derivation all reuse existing machinery; runtime gains a `kind: "class" | "factory"` manifest field and a construction branch.

**As implemented (stage 3), that branch is not `asClass`.** A class unit registers as `asFunction(cradle => new Ctor(cradle))`. Under PROXY injection this is behaviorally what `asClass` does — construct with the cradle as the single argument — but `asClass` exposes no error hook, so a class registered through it would resolve outside the instrumented path: an empty frame stack for that node and a raw `AwilixResolutionError` escaping a root resolve. Routing both unit kinds through the one wrapper keeps `IocResolutionError` unit-kind agnostic.

Positioning: Awilix's own discovery is `loadModules` — runtime `require` of globbed files, filename-derived keys, no typing, no wiring validation, bundler-hostile (third-party shims exist just to make the glob work under Vite). The pitch is "loadModules, but type-checked at build time and bundler-safe," aimed at users who already have the drop-a-class-in-`services/` habit. Key parity is near-automatic (camelCase class name ≈ camelCase filename in one-class-per-file codebases); a migration-mode warning when file stem ≠ class name is cheap insurance.

Open stage-3 decisions: discovery convention (implements-presence with config escape hatch, sketched; explicit opt-in as fallback); multiple `implements` → hard error naming both, config-resolvable; CLASSIC-mode param-name injection deferred; reading Awilix's `static [RESOLVER]` metadata as a syntactic override channel deferred (needs a precedence rule against config `registrations`).

## Ecosystem leverage decisions

- **Config validation → zod strict schema (stage 0).** Whitelist and shape-validation become one artifact; invariant 28 enforced by construction. Two past releases (2.2.1, 2.3.6) were whitelist omissions.
- **Config loading → c12/jiti (deferred to v3 branch).** Deletes the hand-rolled CJS-interop unwrapping, but it is a behavior change and belongs behind the golden harness.
- **TS-internals hijack (`ts.moduleSpecifiers.getModuleSpecifier`) — punted.** Verified reachable on the TS 5.x barrel behind an any-cast, and it is the reference implementation for specifier selection. Punted because the existing code works, the surface is minimal, and the approach is terminal: `typescript@7` (the native compiler, now `latest` on npm) exposes essentially no programmatic compiler API on its barrel. Copying/vendoring `moduleSpecifiers.ts` was rejected: it drags a large transitive slice of the fastest-evolving part of TS.
- **TS 7 horizon.** The entire generator is built on the TS 5 checker API; the 5.x line is supported explicitly (peer range `^5.0.0`) and the native-compiler API story is tracked as an open horizon. Strategic consequence, adopted: do not deepen checker coupling anywhere. The v3 direction — syntactic identity, checker demoted to verifier — is the TS7-resilient direction, independent of every other argument for it.

## Extraction question

Constituent-package breakdown was evaluated. Most layers are ioc-manifest policy, not community primitives. The exception: typed-codegen import fidelity (`emitTypeReference` + reverse specifier resolution) fills a genuine ecosystem gap — tsc solves it internally and exposes nothing. Decision: enforce the seam now (emission as an internally strict module with an explicit options-object context; stage 0), extract as a standalone package only post-v3 and only if the adoption ambition justifies the maintenance multiplier. Extracting before stage 1 would freeze the wrong boundary mid-redesign.

## Roadmap

- **Stage 0 (main, ships as v2.6.0):** re-export and `typeof import` hard errors for generated-file references; zod-strict config schema; emission-seam enforcement; barrel diet to the essential surface. Low risk, closes the live hole, hardens surfaces every later stage touches.
- **Stages 1–4 (`v3` branch, rebased on main after stage 0):**
  1. Identity swap (annotation identity) behind the golden-manifest diff gate; the annotation-required error doubles as migration discovery.
  2. B3 formalization — tests and docs of the enumeration guarantee.
  3. Class units — discovery, `kind` field, class-construction runtime branch, implements-presence convention. Rides the schema bump; `baseTypeId` moves to package-relative ids here for the same reason.
  4. Docs — pitfalls shrinks; philosophy reworded from "inferred, not declared" to "declared at the site, discovered from source"; README class examples.
- **Merge gate:** full monorepo regeneration + boot on the v3 branch, compared against main. Rollback is branch deletion.
- **v3.x polish, adoption-gated (from the consumer migration below).** Cross-package object-group consumption is _not_ an unbuilt gap — it ships today via the `./iocTypes` subpath, with no tool change required. What actually remains is narrower: (a) a validation warning when a package defines groups but exposes no `./iocTypes` (or equivalent) subpath, so downstream composers can reach the aliases without discovering the pattern by trial; (b) optionally, tool-emitted or tool-scaffolded `exports` subpath entries — emit-and-instruct is preferred over the tool rewriting a consumer's `package.json`, consistent with the ejectability principle; (c) first-class scoped-injection support — a sanctioned scope-resolver handle legal in a deps position, and/or consuming a `scopeProvided` value as an ordinary factory dependency — so `RequestScope` view types need not be hand-authored. (c) is gated on the adoption decision, alongside the RESOLVER bridge and the emission-package extraction.

## Consumer findings — first real composing consumer

A five-package nx monorepo (apps `api` and `media-worker` composing context/foundation packages including `media-core`) migrated to v3-rc; `gen:ioc:all` now passes across all packages. What the migration surfaced is recorded here because an earlier reading framed the first item as an unbuilt gap when the capability already ships.

**Cross-package group consumption works today, via a subpath export — no tool change required.** The registry-types file already emits each object group's alias as an `export type` (e.g. `ReadServices`). A package surfaces those aliases to downstream composers through a `package.json` `exports` subpath — in the consumer, `@packages/media-core/iocTypes` maps to the generated `ioc-registry.types` file — and a downstream package imports them directly: `import type { ReadServices, WriteServices } from '@packages/media-core/iocTypes'`. This was verified to satisfy the generated-reference backstop, which correctly distinguishes **importing a foreign package's published generated subpath** — always fine; that file is another package's build output reached through its public exports, and it never re-enters this package's scan graph — from **a package re-exporting its own generated registry out of its own scanned source**, which is the cold-start hazard invariants 9–11 and the stage-0 re-export ban exist to guard against. That distinction is the whole reason cross-package consumption is safe and the antipattern below is not.

**The antipattern that fails, and why.** Two shapes get rejected, both correctly. Re-deriving a group's type at the consumer by indexed access into a local cradle alias — `type ReadServices = AppCradle['readServices']` — is rejected by the backstop as a cradle read. Re-exporting the aliases from a scanned source file — a barrel, or an infrastructure module sitting inside `scanDirs` — trips the stage-0 re-export ban. The correct path is neither: import from the owning package's `./iocTypes` subpath. Re-deriving and re-exporting both put a generated reference back inside a scanned graph; importing across a package boundary does not.

**Scoped / container injection: the working pattern is a hand-authored view type.** Awilix bakes the whole key map into `AwilixContainer<Cradle>`, so injecting the container drags the generated cradle into a deps position and is rejected by the backstop. The migration's working idiom: at each site that injected `AwilixContainer<AppCradle>` (or `<Cradle>`), replace it with `AwilixContainer<RequestScope>`, where `RequestScope` is a hand-authored view type naming only what that site actually resolves — the group aliases it needs, imported from the owning package's `/iocTypes` subpath, plus the `scopeProvided` keys (`viewerId`, `publicLinkId`, a unit-of-work handle). This satisfies the backstop, since no generated cradle appears in the position, while preserving full `.resolve` typing. Package-boundary note: cross-package helpers stay generic over the cradle slice they touch and must not name a downstream app's types — a `beginUnitOfWorkScope` living in `media-core` is generic over that slice; each package names its scope view from its own vantage, and the generic carries the app's type into the library function at the call site. Validated end-to-end across both apps.

**What the respected containers do**, briefly, as design evidence: StructureMap and the .NET canon treat per-request nested/child containers as idiomatic, sanction injecting the container for scoped service location through a type-parameter-free `IContainer` — resolution types come from the call site, not from a whole-app cradle baked into the container type — and support registering runtime values into the scope. Awilix's cradle-typed container is the design choice that creates the friction above.

**Why dogfood missed it.** The library's own examples exercise neither request-scoped resolution nor cross-package object-group consumption, which is why stage 2's backstop was never pressured on these shapes. This class of finding only surfaces from a real composing consumer.

## Open questions

- Return-annotation coverage in the consuming monorepo — resolves automatically from stage 1's error output.
- Object-group key-literal usage count — sizes B3's test surface only.
- Adoption ambition — gates docs investment, RESOLVER bridge, CLASSIC mode, first-class scoped-injection support (roadmap item (c)), and the emission-package extraction. The single strategic decision with the most downstream consequences.
