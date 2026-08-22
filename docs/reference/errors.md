# Error handling

Errors are designed to tell you exactly what went wrong and what to do about it.

**Config errors** are prefixed `[ioc-config]` — unknown contracts in `registrations`, duplicate defaults, key collisions. These fail at generation time before any files are written.

**Discovery errors** are prefixed `[ioc]` — missing return type annotations, contract sites that aren't named types, two contract declarations sharing a name, classes listing several `implements` entries or carrying a non-injectable constructor, duplicate registration keys, overlapping scan directories with conflicting scopes, and factories destructuring directly from `IocGeneratedCradle` (use named deps types instead). Discovery aggregates by category: one run reports every offending export, not the first.

**Generated-reference errors** are prefixed `[ioc]` and name the file, the line, the offending source text, why the form can't be supported, and the supported replacement. See [Consuming generated types](/reference/generated-types#rejected-forms).

**Demand-model errors** are prefixed `[ioc]` and carry a bracketed code per offender. A deps property is one of exactly five declared things — a contract key (the contract's elected default), an implementation registration key marked `Named<T>`, a group root key, a scope-root opener key, or an external — and these are the ways a property fails to be one of them. All of them aggregate: one run lists every offending property, with its unit, file, line and property name.

| code | what it means | fix |
| --- | --- | --- |
| `named-marker-required` | The property's name is an implementation registration key, demanded with a bare contract type. The site cannot be told apart from a contract-key demand or an external. | Pick the one you mean. For the elected default, demand the contract key (`authMiddleware: AuthMiddleware`); for that implementation, write `strictAuthMiddleware: Named<AuthMiddleware>`. The error prints both spellings for your key. |
| `named-contract-mismatch` | `Named<C>` where the implementation's declared contract is not `C`. Identity is exact, never assignability. | Write the implementation's own contract, which the error names, or demand an implementation of the contract you asked for. |
| `named-on-contract-key` | `Named<…>` on a contract slot key. The slot resolves whichever implementation is elected, so "that specific implementation" is not something it can say. | Drop the marker to demand the elected default, or name an implementation's own registration key. |
| `named-on-group-key` | `Named<…>` on a group root key. A group key resolves the whole collection. | Drop the marker, or demand a member's own registration key with `Named<…>`. |
| `named-on-opener-key` | `Named<…>` on a scope-root opener key. An opener is emitted by generation, not registered by an implementation. | Demand it by its emitted alias (`openAuthRouterScope: OpenAuthRouterScope`). |
| `named-unknown-key` | `Named<…>` on a name no implementation — local or composed — is registered under. | An unregistered key is an external; demand it by its plain type. Check the spelling against the registration key. |
| `named-wrong-arity` | `Named` written with anything other than exactly one type argument. | Write `Named<TContract>`. |
| `grouped-member-demand` | The property names a member of a configured group, or a grouped contract's would-be contract key. Grouped ⇒ group-only: members have no cradle keys and the contract has no contract key. All four spellings — `Named<MemberContract>`, `Named<GroupBase>`, the bare member key, and the absent contract key — land here rather than on the strict-identity or unknown-key texts, because the problem is the family and not which contract was named. | Consume the group. The error names the group's key, and for a record group the member property (`channels.emailChannel`). If you need keyed access to a member, the group's `kind` is the lever — or the member does not belong in the group. See [Consumer-divergent group consumption](/design/per-package-manifest#_8-7-consumer-divergent-group-consumption-considered-deferred). |

A contract that elects no default has no contract key at all, and the `named-marker-required` message says so rather than offering a spelling that would not resolve.

```
[ioc] 1 deps property does not declare which of the five things a dependency can be it is. A deps property names either a contract key (the contract's elected default), an implementation registration key marked `Named<TContract>`, a group root key, a scope-root opener key, or an external:
  - [named-marker-required] Class "ArchiveStorage" at ArchiveStorage.ts:18 property "localStorage" is the registration key of implementation "localStorage" (contract "Storage", in this package), demanded without saying so. For the elected default, demand the contract key `storage: Storage`; for this specific implementation, write `localStorage: Named<Storage>`.
```

File paths in this family are scan-directory relative, the same as the other demand-analysis errors.

**Discovery warnings** are prefixed `[ioc]` and never block generation. They cover units that matched a trigger but couldn't be used, concrete classes that inherit a contract without declaring `implements`, abstract classes declaring a contract nothing concrete registers, and class file names that would have keyed differently under Awilix `loadModules`. `ioc inspect --discovery` shows the same findings per export, with a categorized reason.

**Group-lifetime errors** are prefixed `[ioc]` and carry a bracketed code per offender. A group is a family whose members are handed out interchangeably, so the family ranks one lifetime and the base is where it is declared. These aggregate too.

| code | what it means | fix |
| --- | --- | --- |
| `group-lifetime-on-member` | A grouped member's contract declares a `lifetimeMarkers` interface that the group's base does not carry. | Move the marker to the base, so the whole family ranks it — or take the contract out of the group. The error names both. |
| `group-lifetime-config-override` | `registrations[Member][impl].lifetime` is set for a grouped member. | Set the family's lifetime by putting a marker on the base instead. |

A member that redundantly restates the base's own marker is not an error: it is indistinguishable from inheriting it, and the base owns the lifetime either way.

**Composition errors** are prefixed by category (`[externals]`, `[same-key-conflict]`, `[group-base-type]`, etc.) and emitted by the composition suite, which app-mode `ioc generate` runs before writing anything and `ioc validate` runs without regenerating. Both aggregate: a failing run reports every issue at once, not just the first. In `generate` they arrive under `[ioc] App-mode generation refused: …` and nothing is written.

`[registry-integrity]` is the one that gates the others: before comparing types, the suite checks that the generated registry-types files it reads types out of actually compile. A name that does not resolve there becomes an error type, and comparisons against an error type pass regardless of what they are asked — so a broken file is reported as an error, and the comparisons that read from it are skipped and listed as skipped rather than reported satisfied. The usual cause is generated output that predates a source change; re-run `ioc generate` (or regenerate the composed package named in the issue). Errors that survive regeneration mean the file was emitted broken — that is an ioc-manifest bug worth reporting.

**Runtime resolution errors** use `IocResolutionError` with structured dependency chains:

```
[ioc] Cannot build AlbumService using implementation albumService.

Resolution chain:
  AlbumService (albumService) [services/buildAlbumService.ts]
    -> MediaStorage (s3MediaStorage) [services/buildS3MediaStorage.ts]
      -> S3Client ✖ no registered implementation
```

Missing dependencies, cyclic references, lifetime violations, and factory exceptions are all caught and reported with the full resolution path.

A missing **scope-provided** value surfaces here too: resolving a service whose scope value wasn't registered produces a `no registered implementation` leaf for that key. If you see this for a key declared in `scopeProvided`, the fix is to register it onto the child scope before resolving — not to add a factory.

---
