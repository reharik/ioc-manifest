# Pitfalls and troubleshooting

**Manifest out of date** — regenerate after editing factories or `ioc.config`. The generated files are build artifacts; treat them like compiled output.

**Contract not discovered** — the factory's return type must resolve to a named type (interface or type alias). The contract symbol must be imported or declared in the same file as the factory. Anonymous `{ foo: string }` return types are silently skipped.

**Factory destructures `IocGeneratedCradle`** — not allowed. Use a named local deps type instead. The error message names the factory and shows the correct pattern.

**Duplicate registration keys within a manifest** — every implementation needs a globally unique Awilix key. If two factories produce the same key, rename the exports or use `registrations[Contract][impl].name` to override.

**Duplicate registration keys across composed manifests** — composition errors with both manifest sources named. Resolve via `registrations[Contract][impl].source` in the app's `ioc.config`.

**Overlapping scan directories with different scopes** — if a factory file matches multiple scan roots that specify different `scope` values, generation fails. Narrow the roots or set lifetimes per implementation in `registrations`.

**`registrations` for unknown contracts** — keys in `registrations` must match a discovered contract type name exactly. In app mode, that includes contracts from composed manifests. A typo fails with a list of what was actually discovered, locally and from composed packages.

**App mode codegen fails to resolve a composed package** — the package needs `./iocManifest` and `./iocTypes` subpath exports in its `package.json`. Until those are added, app codegen can't import the manifest.

**`_<Pkg>ExternalsAssert` fails to compile** — a composed package's externals are not satisfied by the composition. Add a factory in the app (or in another composed package) that supplies the missing key, or compose another manifest that does.

**Group base type mismatch across manifests** — caused by hoisting producing different physical paths for the same logical type. The error includes the remediation block to paste into `groupBaseTypeAliases`.

**Library-mode invocation of `ioc validate`** — prints an informational message and exits 0. Validate is a cross-manifest tool; a library has no cross-manifest concerns to validate.

**My factory isn't in the group (or didn't get the marker lifetime)** — membership is **nominal**: the contract or return type must declare `extends YourBase` (or `type Foo = Bar & YourMarker`). Structural similarity is not enough. Common mistakes: forgetting `extends` on the service interface; using a union return type such as `Foo | undefined` on the contract — unions are not heritage, so `type Contract = Impl | undefined` will not join a group whose base is `Impl` unless you use `interface Contract extends Impl` instead.

**Every factory in the package got the same lifetime** (v1.1.x and earlier) — that was structural matching on empty markers. Upgrade to v1.2.0+ and use `extends` on the types that should be scoped; empty markers are safe when inheritance is declared explicitly.

**A singleton silently reuses a per-request dependency** — if a `singleton` depends (directly or through a chain) on a `scoped` or scope-provided value, it captures one instance at first construction and never refreshes it; per-request state goes stale with no runtime error. `ioc generate` fails on `singleton → scoped` edges for exactly this reason. Make the consumer `scoped`, or mark deliberate cases with `allowLifetimeInversion`. See [Lifetime inversion checks](/concepts/lifetimes#lifetime-inversion-checks).

---
