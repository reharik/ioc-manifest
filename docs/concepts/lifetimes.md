# Lifetimes

Every registration has an Awilix lifetime — `singleton`, `scoped`, or `transient`. This page covers the three ways to assign them (markers, folder scope, explicit config) and the generation-time check that catches lifetime inversions before they become runtime bugs.

## Lifetime markers

When services are organized by domain (`src/users/`, `src/orders/`) rather than by lifetime category, folder-scoped lifetimes fit poorly. **Lifetime markers** express cross-cutting lifetime policy via marker interfaces — the same **nominal** membership rules groups use (declared `extends`, not structural assignability).

### Defining a marker

A marker is typically an empty interface (or a type alias you intersect with). Selective matching comes from **where you attach `extends`**, not from branding:

```ts
// shared types
export interface IScoped {}

export interface ITransient {}
```

### Declaring markers

Map marker types to lifetimes in `ioc.config`:

```ts
lifetimeMarkers: {
  IScoped: "scoped",
  ITransient: "transient",
},
```

Keys are interface or type-alias names visible in the package's TypeScript program at codegen. Values are `singleton`, `scoped`, or `transient`. An empty object `{}` skips marker analysis.

### Attaching markers to factories

Three attachment points, in order of locality. The pattern that fits your code best is usually the right one.

**Directly on the implementation type:**

```ts
export interface RequestTracingLogger extends LoggingService, IScoped {
  ping: () => string;
}
```

**On a shared contract** (every implementation of `LoggingService` becomes scoped):

```ts
export interface LoggingService extends IScoped {
  log: (msg: string) => void;
}
```

**On a group base type** — the cleanest pattern when implementations are already collected as a group. Every implementation in the group inherits the lifetime automatically:

```ts
export interface DiscountStrategy extends IScoped {
  applies: (order: Order) => boolean;
  calculate: (order: Order) => number;
}
```

Transitive inheritance does the rest. You attach the marker once on the right level of abstraction; codegen finds it on every implementation downstream.

### Precedence

For any factory, the lifetime resolves in this order (highest first):

1. `registrations[Contract][impl].lifetime` — explicit per-impl override
2. Lifetime marker on the return type
3. `discovery.scanDirs[].scope` — folder-scoped default
4. Default: `singleton`

### Multiple markers is a hard error

If a return type matches two markers, codegen errors and names both. Silent first-wins would create the worst kind of bug — a service's lifetime quietly differs from what the developer intended. Resolve by removing one marker from the inheritance chain or setting the lifetime explicitly via `registrations`.

### Cross-package behavior

Marker types must be declared in source files visible to the package's TypeScript program at codegen — typically the same package's `src/`. Library packages bake their resolved lifetimes into their manifest at _their_ codegen time; composing apps do not re-run marker resolution on library factories. A library's choice of marker is invisible to consumers; what they see is the resolved lifetime in the registration.

## Folder-scoped lifetimes

Folder-scoped lifetimes are a **legacy pattern** for codebases where directory layout mirrors lifetime boundaries. For domain-organized code, prefer [lifetime markers](/concepts/lifetimes#lifetime-markers) instead.

If implementations are co-located by lifetime category, you can default lifetimes by scan root:

```ts
discovery: {
  scanDirs: [
    { path: "src/services", scope: "scoped" },
    { path: "src/repos", scope: "scoped" },
    { path: "src/infra", scope: "singleton" },
    { path: "src/handlers", scope: "transient" },
  ],
},
```

This came out of a real pattern: in a GraphQL API, services and repositories are scoped to the request, infrastructure clients (database pools, caches) are singletons, and HTTP handlers are transient. Instead of repeating that in `registrations` for every single factory, you express it structurally — the directory _is_ the policy.

Per-implementation overrides in `registrations` and lifetime markers take precedence over folder scope.

## Lifetime inversion checks

Awilix lifetimes have an ordering: a `singleton` lives for the life of the container, a `scoped` instance lives for one scope (typically one request), a `transient` is rebuilt on every resolve. When a longer-lived registration depends on a shorter-lived one, the longer-lived service captures a single instance of that dependency at first construction and reuses it forever — quietly defeating the shorter lifetime.

The classic case: a `singleton` that depends on a `scoped` repository holding a per-request unit-of-work. The singleton is built once, captures one repository, and every later request writes through that first request's transaction. Nothing throws; the state just silently goes stale. The consumer doesn't even have to touch the scoped resource — holding something that holds it is enough.

`ioc generate` catches this statically. It walks every dependency edge over the resolved graph and flags any edge where the dependency is shorter-lived than the consumer:

- **`singleton → scoped`** is an **error** — generation fails. This includes a scoped dependency reached through a group (a group with a scoped member) or a scope-provided key (per-request, so effectively scoped). It is almost never intentional.
- **`singleton → transient`** and **`scoped → transient`** are **warnings** (`[ioc]`-prefixed). A singleton legitimately holding a transient factory it constructs from per use is a real pattern, so these surface for review without blocking.

The check resolves each demanded key precisely — a specific registration key, a contract's default slot, a group's members, or a scope-provided key — so it names the exact dependency rather than guessing across a contract's implementations. Findings aggregate: every warning prints, and if there are errors, generation throws once with the full list rather than failing on the first one.

A typical error:

```
Lifetime inversion: 'grantSync' (singleton) depends on 'grantRepository' (scoped). A singleton freezes its scoped dependency at first construction, reusing it across all scopes. Register 'grantSync' as scoped (or shorter), or mark it intentional with registrations['Grant'].grantSync.allowLifetimeInversion.
```

The usual fix is the obvious one — the consumer should be `scoped`:

```ts
registrations: {
  GrantSync: {
    grantSync: { lifetime: "scoped" },
  },
},
```

**Intentional inversions.** If an inversion is deliberate — a singleton that holds a transient factory and constructs from it per call — opt out with `allowLifetimeInversion` on that implementation:

```ts
registrations: {
  ConnectionPool: {
    // allow all shorter-lived deps for this implementation:
    connectionPool: { allowLifetimeInversion: true },
    // or allow only specific demanded keys (preferred):
    // connectionPool: { allowLifetimeInversion: ["connectionFactory"] },
  },
},
```

Prefer the `string[]` form. `true` silences every inversion for that consumer — including ones you introduce later and didn't mean to. Listing the keys you're knowingly inverting keeps the rest of the check live. The field is config-only and never appears in the generated manifest.
