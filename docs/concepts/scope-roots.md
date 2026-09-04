# Scope roots

A **scope root** is a unit that can only be built inside a child scope, because part of what it needs does not exist until the scope is opened — a request's viewer id, a request's unit of work. Declaring one makes generation emit an **opener**: a function in the cradle that takes those values, registers them on a child scope, and resolves the unit there.

The design document behind this is [`design/scope-roots`](/design/scope-roots); this page is the working version.

## The problem

Some values are per-call, not per-container. The classic shape is an HTTP request: a router is built once per request because it needs that request's viewer, and everything under it inherits the same constraint.

The container cannot supply those values. Registering them on the root container would be a lie — there is no "current viewer" at the root — and leaving them out means the subtree cannot be resolved at all. What is needed is a boundary: a place where per-call values enter, with a declaration of exactly which values those are.

## Declaring a scope root

A unit becomes a scope root by annotating its contract site with `ScopeRoot<TContract, TLateBound>`:

```ts
import type { ScopeRoot } from "ioc-manifest";

type AuthRouterDeps = {
  viewerId: string;
  uow: UnitOfWork;
  policyService: PolicyService;
};

export const buildAuthRouter = ({
  viewerId,
  uow,
  policyService,
}: AuthRouterDeps): ScopeRoot<IRouter, { viewerId: string; uow: UnitOfWork }> => ({
  // …
});
```

The second type argument is the **declared late-bound-value set** (the "lbv"): the keys that enter at the scope boundary. It is *declared*, never derived. Generation could in principle infer it by walking the subtree, and deliberately does not — the boundary is a contract with every call site, and a contract that silently widened when someone three files away added a dependency would not be one.

`ScopeRoot` is a phantom type. It is `TContract` as far as TypeScript is concerned and nothing exists at runtime; the generator reads it syntactically, the same way it reads `Promise<T>`.

## The emitted opener

A scope root claims no cradle key of its own. What goes into the cradle is the opener:

```ts
const router = container.cradle.openAuthRouterScope({ viewerId, uow });
```

The opener key is derived from the variant name (`authRouter` → `openAuthRouterScope`). It opens a child scope, registers each declared late-bound value on it `asValue`, resolves the unit inside that scope, and hands it back. Everything under the root resolves in the child scope, so every unit in the subtree sees the same per-call values.

`ioc inspect` lists every emitted opener with the keys it requires, and `ioc explain <openerKey>` prints the same for one of them.

## Variants

One contract may have several scope roots — an `authRouter` and a `publicRouter`, both `IRouter`. Each is a **variant**, identified by its factory, and each declares its own late-bound-value set and gets its own opener. Verification is per variant and never merged across them: two variants of one contract have different declarations and different subtrees, so a verdict about one says nothing about the other.

## Verification

Generation walks each variant's resolution subtree and compares what the subtree demands against what the variant declares. Four things can come out of that walk, each with its own code.

### Missing keys

`lbv_missing_key` — a unit under the root demands a key that no manifest registration supplies and the declaration does not name. Nothing will satisfy it at runtime, so this fails generation.

The error names the demanding unit and the path the walk took to reach it, which matters: the demand is usually several units below the root, and the path is how you find it. The fix is normally to add the key to the declaration — or, if the key was supposed to be an ordinary registration, to work out why discovery did not register it (see [troubleshooting](#troubleshooting)).

### Type mismatches

`lbv_type_mismatch` — the declaration names the key, but the type it declares is not assignable to what the subtree demands.

The check runs **supplied extends demanded**: the value the scope carries has to satisfy every consumer under the root, never the other way round. Widen the consumer's type or narrow the declaration.

### Unused declared keys

`lbv_unused_key` — the declaration names a key nothing under the root demands. A warning, not an error: the code runs. But the boundary contract carries dead weight, because every call site must pass a value that nothing resolves. Either remove it, or wire up the consumer that was meant to demand it.

This one is also how a *removed* consumer surfaces: a key that was demanded last month and is not demanded now shows up here rather than silently persisting in the declaration.

### Composed blind spots

`lbv_composed_blind_spot` — the subtree reaches a composed package whose manifest carries no dependency data *it vouches for in full*, so that part of the subtree could not be walked.

Advisory, never an error, and printed even next to a satisfied verdict, because it qualifies the verdict itself: "satisfied" over a subtree that was only partly walked is exactly the false confidence this line exists to remove.

Two different states raise it, and the advisory names both because the fix differs:

- The manifest predates per-unit `dependencyKeys` entirely. Regenerate that package with a current version.
- The manifest carries keys but does not claim [`dependencyKeysComplete`](/guide/what-gets-generated#manifest-feature-tokens) — some factory there takes its dependencies as a plain parameter (`(deps: Deps)`) or a rest/computed binding, shapes the keys cannot be read from. Regenerating alone will not clear it: those factories have to destructure their deps parameter (`({ a, b }: Deps)`) so their demands can be recorded. That package's own generation names them, file and line.

Either way, re-run generation here afterwards. The older `dependencyKeys` token is *not* enough on its own: it says the generator knew the field, not that every unit's demands were determined, and reading it as coverage is what used to suppress this advisory over a subtree nobody had walked.

## Troubleshooting

**"This key used to resolve and now it doesn't."** A key that was an ordinary registration and has become an unsatisfied scope-demand did not change at the demand site — it changed at the *supply* site. The walk reports "no manifest registration supplies this" for a key whose factory is no longer being discovered, and the most common reason is that it stopped being scanned.

Check, in this order:

1. **Is the supplier still discovered?** `ioc inspect --discovery` lists every scanned file and every export's outcome. If the factory is not in the list at all, it is not being scanned.
2. **Was it excluded by config?** The discovery report's footer counts files that `discovery.excludes` kept out of the scan, and `--verbose` (or `--json`) names them. A glob added for an unrelated reason is a common cause, and an excluded file never produces a skip row of its own — it is not scanned, so nothing records an outcome for it. The footer count is the only heartbeat it has.
3. **Is it discovered but skipped?** A near-miss row names the reason: a missing return-type annotation, a contract that is not imported in the file, a class inheriting a contract it does not restate.
4. **Is it registered under a different key?** `ioc explain <key>` says whether anything answers to the name, and lists similar keys when nothing does.

**"The subtree reaches something it shouldn't."** `ioc explain <key> --discovery` names every scope-root variant whose subtree reaches a given key. If a unit is reachable both inside a declaring subtree and outside it, the late-bound value it demands stays in `IocExternals` — the discovery report lists those units under **Shared scope-root units**, with the key and the variant, so the cause is visible rather than deduced from an unexpected externals entry.

**"Verification passes but I don't trust it."** Look for the composed blind-spot line. A verdict over a partly-walked subtree is reported as satisfied with the blind spot stated next to it, and that line is the qualification.
