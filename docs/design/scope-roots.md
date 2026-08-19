# Scope-root registration units

**Status:** Staged. Stages 1 (discovery) and 2 (generation-time subtree verification) implemented on the `scope-roots` branch, post-3.0.0. Stage 3 unstarted. Stage 2 verifies and reports only — call-site/ambient enforcement in consumer code needs the emitted builder, which is stage 3.

**Date:** August 2026 (against v3.0.0)

## The problem

v3 has no declared form for request-scoped or worker-scoped resolution. The container is one flat cradle of singletons; anything that varies per request — a viewer id, a public-link id, a unit-of-work handle — is a value that enters at a runtime scope boundary and is demanded deep inside a resolution tree that the generator planned statically. The tool models the tree and models the boundary's _supply_ (`scopeProvided` keys are excluded from externals, invariant 18), but it models nothing about the boundary itself: not what opens it, not what it resolves, not which late-bound values it must carry.

The consumer findings in [`v3_audit.md`](./v3_audit.md) recorded what fills that hole in practice. Awilix bakes the full key map into `AwilixContainer<Cradle>`, so injecting the container drags the generated cradle into a deps position and the generated-reference backstop rejects it. The working idiom the photo-app migration converged on is a hand-authored view type: replace `AwilixContainer<AppCradle>` with `AwilixContainer<RequestScope>`, where `RequestScope` is written by hand and names only the group aliases that site resolves plus the `scopeProvided` keys (`viewerId`, `publicLinkId`, a unit-of-work handle). Scope opening is likewise hand-authored — a `withUnitOfWork` / `beginUnitOfWorkScope` helper, generic over the cradle slice it touches, with each package naming its own scope view from its own vantage.

That idiom works and is validated end-to-end across two apps, but everything load-bearing in it is unchecked prose:

- The view type is hand-maintained. Nothing relates it to what the subtree actually resolves; it drifts silently in both directions (a key nobody resolves, a key resolved but not named).
- The scope-opening call site is hand-written per boundary. Registering the late-bound values onto the child scope is a sequence of `container.createScope()` + `register` calls whose completeness is checked by nothing.
- The contract _resolved from_ the scope (the router, the worker entry) has no relationship in the tool to the scope that produces it. To the generator these are unrelated singletons.

Roadmap item (c) of the audit named the gap — "first-class scoped-injection support ... so `RequestScope` view types need not be hand-authored" — and gated it on the adoption decision. This document is that feature, designed.

## The core principle: the lbv set is declared, not derived

**The late-bound-value (lbv) set of a scope is declared by the developer. The tool never derives it.**

The tempting design is the opposite one. The generator already walks the resolution tree; it can see which nodes demand `viewerId`; it could compute the lbv set of a scope as the union of scope-demands in the subtree under the scope's root contract. That would remove an authoring step, and it would be wrong.

The lbv set is a _boundary contract_. It is what the caller of the scope must supply, and it is the signature every scope-opening call site is written against. Deriving it from subtree analysis makes that contract an inferred output: adding a leaf dependency four levels down that happens to demand `publicLinkId` would silently widen the boundary's signature, and removing one would silently narrow it. The failure is not that the inference is hard — it is easy — but that the resulting contract changes without anyone declaring a change, and the change surfaces at every call site at once, as a type error whose cause is in an unrelated file.

This is exactly the failure mode the v3 audit's Class A invariants were created to eliminate. Class A — twelve of thirty-seven invariants and the majority of post-1.0 patch releases — traced to one commitment: contracts inferred from return-type symbols. The v3 fix was not better inference; it was demotion of inference. Identity became a declared, syntactic site (a return annotation, an `implements` clause), and the checker was demoted from identity-source to verifier. The philosophy line was reworded from "inferred, not declared" to "declared at the site, discovered from source" for the same reason.

A derived lbv set would reintroduce the retired mistake in a new position — and in a worse one, because a contract identity at least has a single declaring file, whereas a derived lbv set has no declaring site at all.

So: **the tool's role is to verify the declared lbv against the subtree (stage 2), never to synthesize it.** When the declared set and the subtree disagree, the tool reports the disagreement and names both sides; it does not pick a winner. This preserves the property that makes v3's identity rule work — a reader can determine the boundary contract by reading the declaration, without following a dependency graph into other files.

## The declaration mechanism

A scope-root is declared the same way v3 declares everything else: at a contract site, syntactically, with type arguments the reader can see.

A **scope-root factory** is a factory whose return type annotation is the marker type

```ts
ScopeRoot<TContract, TLbv>;
```

exported from `ioc-manifest`.

- `TContract` is the **root contract** — the thing resolved _from_ the scope once it is open. For an HTTP boundary that is the router (`IRouter`); for a worker boundary it is the worker entry point.
- `TLbv` is the **declared late-bound-value set** — an object type whose members name the values that enter at the scope boundary and their types, e.g. `{ viewerId: ViewerId; uow: UnitOfWork }`.

```ts
import type { ScopeRoot } from "ioc-manifest";
import type { IRouter } from "./contracts.js";

export const buildAuthRouter = (
  deps: AuthRouterDeps,
): ScopeRoot<IRouter, { viewerId: ViewerId; uow: UnitOfWork }> => { ... };
```

Both type arguments are **declared syntactic type arguments**, read exactly the way v3 reads every other contract site: by name, from the AST, with the checker acting only as a declaration locator. `TContract` resolves through the ordinary contract-identity path, so a scope root's contract obeys every rule an ordinary contract obeys — aliases are not followed, import aliases are, generic instantiations are preserved, and the written name must be locally declared or imported.

`ScopeRoot` is a phantom type. It is `TContract` intersected with one optional, never-populated property carrying `TLbv`, so a factory that builds an `IRouter` can return it unchanged and the annotation still type-checks. Nothing about the marker exists at runtime.

### Recognition is a marker-unwrap, not a new identity rule

The resolver recognizes `ScopeRoot<C, L>` the same way it already recognizes `Promise<T>`: by written name, syntactically, with no checker involvement, unwrapping to the inner contract site. `Promise<T>` and `ScopeRoot<C, L>` are both wrappers that are _not themselves_ the contract; recognizing them is one function, and the two markers compose in either order (`Promise<ScopeRoot<C, L>>` is an async scope-root factory). What follows the unwrap — resolving the site to a declaration, deriving the contract name, resolving the type-only import specifier — is the unchanged v3 path.

This inherits the Promise precedent's known trade: recognition is by name, so a locally-declared `ScopeRoot` shadows the marker just as a locally-declared `Promise` shadows the built-in. That is consistent with v3's identity rule — what you wrote is what you get — and it keeps the generator off the checker for a decision that must stay mechanical.

The marker is a factory-return form only, and falls out that way without a special case: an `implements` heritage entry is a `ts.ExpressionWithTypeArguments`, not a `ts.TypeReferenceNode`, so the marker read never matches there. A class scope-root unit is not designed; whether one makes sense is a stage-3 question, since what a scope root produces is a builder, not an instance.

`ScopeRoot` written with any arity other than two is a **hard error**, not a skip. A one-argument `ScopeRoot<IRouter>` is unambiguously an attempt to declare a scope root, and the missing declaration is precisely the thing this feature refuses to infer; silently treating it as an unsupported annotation would drop the unit into the "prefix-matched but unregisterable" bucket and hide the real message. The error names the expected form.

## Variants

Several factories may return `ScopeRoot<SameContract, ...>`. They are **variants of one scope-root**:

```ts
export const buildAuthRouter   = (d: AuthDeps):   ScopeRoot<IRouter, { viewerId: ViewerId; uow: UnitOfWork }> => ...
export const buildPublicRouter = (d: PublicDeps): ScopeRoot<IRouter, { publicLinkId: PublicLinkId }> => ...
```

Both are scope roots of `IRouter`. They differ in what the scope supplies and in what builds it — an authenticated request boundary and a public-link request boundary are two boundaries into the same router contract, with different late-bound values.

**The variant is the factory identity — never a type parameter.** The variant set of a scope-root is the set of factories declaring that root contract, distinguished by module path and export name (and by the derived implementation name, `authRouter` / `publicRouter`). A scope-root's variants are enumerable at declaration time by reading declarations, which is what stage 3 needs in order to emit one builder method per variant.

The rejected alternative is making the variant a type parameter — `ScopeRoot<IRouter, TLbv>` with `TLbv` supplied by the caller, or a `ScopeRoot<IRouter<TVariant>, ...>` discriminator. This is explicitly out of scope and must be rejected, for the reason the v3 resolver already rejects type-parameter contract identities: an un-instantiated type parameter cannot be analyzed at declaration time. There is no set of variants to enumerate, no lbv object type to verify a subtree against, and nothing for stage 3 to emit a signature from — the information exists only at call sites the generator does not read. `resolveAnnotationContract` returns `unsupported` when a contract site resolves to a `ts.TypeParameterDeclaration`; a scope root inherits that rule unchanged, because its contract site goes through the same resolution path.

**Generic scope-roots — `ScopeRoot<IRouter<T>, ...>` — are out of scope for now.** Not rejected in principle: generic instantiations are preserved elsewhere in the tool (invariants 6–7), so a _fully instantiated_ generic root contract has a plausible path. But the interaction between a generic root and per-variant builder emission is unexplored, and stage 1 has no reason to open it.

## Staged plan

**Stage 1 — discovery (implemented here).** Recognize the marker at the contract site, resolve the root contract through the existing path, capture the declared lbv type argument as an unresolved `ts.TypeNode`, record the unit as a scope root with `scoped` lifetime, and group units by root contract into variant sets. Report scope roots through the ordinary discovery outcomes and through a categorized section in `ioc inspect --discovery`. Nothing is verified and nothing is emitted.

**Stage 2 — subtree verification.** With the resolution tree for the root contract in hand, collect the _scope-demands_ of the subtree — the keys resolved under the root that are not supplied by the singleton container — and check the declared `TLbv` against them. The check runs in the direction the externals-satisfaction check already runs (invariant 17): **supplied `extends` demanded**, per-key `Pick`-indexed assertions, so the declared lbv object must be assignable to the demanded shape. A declared key the subtree never demands is a warning (the boundary carries dead weight); a demanded key the declaration omits is an error naming both the declaration site and the demanding node. The tool reports; it never rewrites the declaration.

In generation mode, `external` is decided by **membership** in the demand/supply pass's externals set, never by elimination. The consequence is specific: a key demanded by the scope-root unit itself must be declared in that variant's lbv. Scope roots are excluded from `acceptedFactories`, so demand/supply never walks them — a root-own key reaches neither the externals set nor the emitted `Externals` interface, and no check anywhere downstream would ever see it. A subtree key in the same position at least fails loudly at composition, wrong reason or not; a root-own key would resolve to nothing with no complaint from anyone, which is exactly the silence stage 2 exists to remove. (Emitting root-own demands into `Externals` is the other half of that question and stays a stage-3 decision, since it changes what the manifest carries.) Inspection, which runs no demand/supply pass, keeps classifying by elimination and therefore reads such a key as container-supplied. The divergence is intentional and is the same stance the group-key row takes: generation is the authority, and inspection is a view that must never invent a failure generation does not have.

The subtree walk inherits the demand set ordinary factories are analyzed with: the destructured deps property names. That carries the same prefer-omission limitation — a unit whose deps parameter is not a top-level object binding pattern (a rest spread, a non-destructured parameter) contributes no edges, so a scope-demand reachable only behind one is invisible to this check. Accepted rather than special-cased: the alternative is a scope-root-only demand rule that disagrees with every other demand analysis in the tool, and the omission is the same one lifetime inversion and dependency-contract inference already live with.

**Stage 3 — per-variant builder emission.** Emit a typed builder per variant whose method signature is taken **from the declared `TLbv`** — not from anything inferred — so opening an authenticated request scope is one typed call that cannot omit a value, and `AwilixContainer<RequestScope>` view types stop being hand-authored. Two open questions belong to this stage: how the variants of one root contract relate to ordinary default election (today, two factories returning `IRouter` are two implementations of one contract competing for one default slot — variants are not that, and must not be planned as that), and whether a scope root also registers anything in the parent cradle.

## Stage-1 boundary: discovered and reported, not manifest-emitted

Stage 1 stops at discovery. Scope-root units are recognized, recorded, and reported, and they reach **no** manifest.

Concretely, a scope-root factory is excluded from the `contractMap` and from `acceptedFactories`, and is returned from `discoverFactories` as a separate `scopeRoots` collection. It therefore takes no part in the registration plan, claims no cradle key, elects no default, and appears in neither `ioc-manifest.ts` nor `ioc-registry.types.ts`.

This is the honest boundary rather than a conservative one. Every alternative places a registration in the cradle:

- Registering the scope root as an ordinary scoped implementation of its root contract would alter runtime registration, which stages 2–3 have not designed yet — and would immediately create the default-election conflict noted above, since two variants would present as two implementations of one contract.
- Emitting a placeholder manifest field would freeze a manifest schema shape before stage 3 knows what the builder needs, and the schema is versioned and checked at composition (invariant 19).

Nothing in the manifest means nothing to migrate when stage 3 decides. The observable stage-1 surface is exactly: discovery outcomes, the aggregated wrong-arity error, and `ioc inspect --discovery`.

Two consequences follow and are accepted deliberately for this stage:

- A scope-root's root contract does not participate in the contract-name-collision check, and its registration key is not claimed in the global namespace. Both checks exist to protect manifest keys, and a scope root has none yet. Stage 3 will bring the emitted surface back under them.
- A scope-root factory's dependencies are not enriched with inferred dependency contracts, and it is not walked for lifetime inversion. Both are demand/supply analyses, which stage 2 owns.

## What stage 1 deliberately does not do

- No lbv verification. The declared type node is captured verbatim and never resolved, never checked for assignability, never compared against anything.
- No builder emission, no runtime registration, no manifest field.
- No demand/supply analysis of the lbv set.
- No config surface. A scope root is declared entirely at the factory; `ioc.config.ts` gains nothing.

# scope-roots.md additions

## 1. Append to the core-principle section

Per-root declarations are complete and self-contained. A scope root at any depth declares every lbv key its subtree resolves — including keys an enclosing scope also happens to supply. The tool never models scope ancestry: nesting is a runtime arrangement, not a verified relationship. This is what makes roots transportable — relocate a scope and the check re-runs against the full declaration at the new site; a key that was silently ambient at the old site fails loudly at the new one instead of resolving by accident through a chain that no longer exists. The corollary for diagnostics: when a check fails on a key the developer knows an outer scope supplies, the error must say declarations are per-root and complete — declare it here — or the failure reads as a tool bug.

**Completeness governs scope ancestry, not the root container.** The transportability argument above is an argument about scopes: a scope can be re-mounted under a different parent scope, so a key the enclosing scope happened to carry may not be there at the new site, and only a complete declaration survives the move. The root container is not a parent scope in that sense. A scope root is a child of exactly one container and cannot be transported away from it, so there is no relocation scenario against which redeclaring the container's own registrations would protect. Container-supplied therefore means manifest registrations, group keys, **and externals**: a subtree dependency that resolves to an external is not a scope-demand, and must not be required in a variant's lbv.

Externals and late-bound values are distinct concepts with distinct lifecycles, and collapsing them would degrade both. An external is a container constant — supplied once at composition by the app that owns the root container, and verified there by the existing externals-satisfaction check (invariant 17). A late-bound value is supplied afresh at every scope opening, and verified against the subtree by the check in stage 2. Requiring externals in an lbv set would put container constants into a per-opening signature, so every opening site would restate values that never vary and the boundary contract would stop describing the boundary. What makes a key a late-bound value is a declaration: naming it in a variant's `TLbv`, or listing it in `scopeProvided`. Everything else the container supplies, the container supplies. When a key is both declared in a variant's lbv and classified external, the declaration wins and the key is verified as a late-bound value — deliberately not a conflict diagnostic, because the two readings agree on what must be true.

## 2. New stage-2 subsection — satisfaction semantics

Supplied means: the keys this opening passes explicitly, plus keys statically visible in the lexically enclosing scope's type at the site where that type is concrete. Ambient satisfaction is deliberate — requiring the opener to re-plumb values the enclosing scope already holds would be ceremony restating what the types already declare — and it costs no transportability, because the check is per-site: move the opener and ambient keys are re-verified where it lands.

Two consequences fix the check site. For generic scope-opening helpers (the `beginXScope` pattern, generic over a cradle slice), the helper cannot be the check site — the enclosing scope's type is not concrete there. The demand travels inward as a generic constraint and the check lands at the concrete call site. For deferred openers (a scope-opening closure created in one place and invoked in another), ambient means the scope the closure lexically captures, never the scope active at invocation. Satisfaction is decidable from declarations at the check site; dynamic scope never participates.

## 3. Append to the variants section

Because factory identity is the variant, an opening site selects its variant, and satisfaction is checked against that variant's declared lbv — never a union or intersection across variants of the contract. The stage-2 check signature therefore takes the variant identity as a parameter from the start; stage 3's cradle-presence design inherits a check that already discriminates by variant rather than retrofitting one.

## Stage 3: cradle presence and the emitted opener

### The framing

A scope is a container. The root container is created once, is supplied its late-bound values (externals) at composition, has that supply verified by the externals check, and is accessed through a generated typed surface (the cradle). An opened scope is created N times, is supplied its late-bound values (lbv) at open, has that supply verified by stage 2 at generation and by the opener's signature at every call site, and is accessed through the opener's typed return. Externals are lbv at frequency one. The concepts remain distinct — supplied-once-verified-at-composition and supplied-per-open-verified-per-call are different lifecycles — but they are the same shape, and stage 3 is the generator doing for the Nth container exactly what composition already does for the first. Hand-opening a scope (`createScope`, string-keyed `register`, a cast on `resolve`) is the same disease at frequency N that hand-wiring registrations was at frequency one, and it gets the same cure: generated, typed, verified.

### One container, one resolve

A container — root or scope — is resolved exactly once, for exactly one unit. Needing a second resolve from the same container means a composing module is missing: write a unit whose deps are the several things you wanted, and resolve that. This holds at the root (a bootstrap that resolves five things and wires them by hand is the anti-pattern; the fix is an `app` unit whose deps are those five things and whose `start` does the wiring, leaving bootstrap as create-container, resolve `app`, start) and at every scope (a request scope that resolves a router, an audit log, and a notifier is missing the unit that composes them). This principle is what fixes the opener's return shape: there is no multi-resolve view to emit, because a scope that wants one is misdeclared.

### What stage 3 emits

Variants claim no root-cradle keys. The ambiguous-default problem is not solved; it is unasked — a variant is not a competing registration, it is a different scope. Per variant, the generator emits an **opener**: a unit registered in the cradle under its own key, injectable as an ordinary dependency, with the shape

    openAuthRouterScope(lbv: { viewerId: ViewerId; uow: UnitOfWork })
      → { authRouter: IRouter; dispose(): ... }

The opener closes over the scope that resolved it, creates a child scope, registers each lbv value and the variant factory (routed through `asFunction(cradle => ...)` scoped, preserving the instrumented resolution-error path), resolves the variant eagerly, and returns it with a disposer. No `AwilixContainer` type appears in the parameter or return — the opener is the sanctioned scope-resolver handle legal in a deps position (audit roadmap item (c)), and it is what retires both the hand-authored `RequestScope` view types and the container self-registration (`container: asValue(container)`), whose only consumer was request-path code needing to hand-open scopes. A stage-3 acceptance test against the consuming apps is the deletion of that line.

The lbv parameter is where §2's call-site semantics land: forgetting a key or supplying a wrong type is a compile error at the opening site, checked by TypeScript against the emitted signature. Because an injected opener is closed over a statically anonymous scope, its signature requires the full declared lbv at every call — there is no ambient omission of outer-scope lbv. Ambient supply narrows to what the container chain provides for free (registrations, externals, via Awilix parent-chain resolution); outer-scope lbv is passed explicitly by the caller. This is the completeness principle surfacing in the API rather than a ceremony cost: nested roots redeclare and re-pass, and remain transportable for exactly that reason.

### Scope roots join demand-supply

Stage 2 left scope-root units invisible to `analyzeDemandSupply` (they are absent from `acceptedFactories`), which forced every root-own demand into the lbv even when it is a genuine container constant. Stage 3 adds scope-root units to the demand walk as consumers. A root-own demand not satisfied by registrations and not declared in the variant's lbv then flows to the `Externals` interface like any other unregistered demand, and the generation-mode classifier's membership rule continues to hold: external means present in the demand-supply externals set. The stage-2 divergence note (inspection permissive, generation authoritative) is unchanged.

### Declared lbv keys are scope-supplied; the config need not repeat them

A key is excluded from `Externals` emission when it appears in `config.scopeProvided` **or in any variant's declared lbv**. If a declared lbv already says it, the config never has to say it again. The aggregate is a union across variants, which is legitimate here and only here: it is an aggregation of written declarations — every element traces to an lbv someone typed — and it feeds Externals exclusion exclusively. Satisfaction remains strictly per-variant; no check anywhere consults another variant's lbv. `config.scopeProvided` survives for hand-opened scopes that have no `ScopeRoot` declaration to speak for them, and the existing rules around it (built-and-scope-provided hard error, undemanded-declaration warning) are untouched.

Per-variant divergence — a key declared in one variant's lbv while another variant of the same root consumes it from the container — is not an error. Under the opener model it has a precise meaning: the declaring variant's opening sites override a container constant per-open; the other variant inherits the constant through the parent chain. Legal, occasionally exactly what is wanted, and worth at most an informational line in `--discovery`.

### Collision rules turning on

With emission, the stage-1 exemptions end where they can. A contract that is both scope-rooted and ordinarily registered is a **hard error**: allowing it makes `deps: { defaultRouter: IRouter }` legal while `deps: { authRouter: IRouter }` is not, for reasons invisible at the interface — a split-brain contract. The mixed mode ("container default plus scoped variants") is coherent and deliberately deferred until real usage demands it; relaxing a hard error is cheap, un-shipping the confusion is not. Opener keys join global key-uniqueness (an opener key colliding with a registration key, group key, or another opener key is the existing conflict machinery's business). Global key-uniqueness for the variants themselves remains vacuous — they still claim no root-cradle keys — which is not an exemption but a consequence of the design.

### Consequence accepted

Scope-rooted contracts are opener-only. No variant is reachable through a root-cradle key or an ordinary deps position; a consumer that wants a variant as a plain dependency is asking for an ordinary factory, which is a different declaration. This is the line that keeps the model whole, and it is drawn on purpose.
