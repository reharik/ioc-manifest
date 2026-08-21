# Pitfalls and troubleshooting

**Manifest out of date** — regenerate after editing units or `ioc.config`. The generated files are build artifacts; treat them like compiled output.

**A factory has no return type annotation** — v3 requires one on every prefix-matched export. Generation fails with a single aggregated error listing every offender by file and export name; that list is your migration worklist. `ioc inspect --discovery` reports the same offenders under `missing_return_type_annotation`.

**A contract site isn't a named type** — an inline object literal (`(): { get: () => User } =>`) or an anonymous union (`(): EmailTask | SmsTask =>`) fails generation. Name the type and use the name. Nothing here is skipped silently.

**Codegen refuses to emit a type it cannot import** — the generated file only prints names it can also import. When a demanded or supplied type is anonymous (nothing names it) and its printed shape mentions a name no import binds, or an emitted import names something its module does not export, generation fails naming the contract, the position, and the offending names, and writes nothing:

> `[ioc] Refusing to emit a type the generated registry file could not compile at the deps type of buildReportView in src/reports/buildReportView.ts, property "handlers".`
> `  emitted type text: { onEvent?: Hook<AppContext> | undefined; }`
> `  the generated file would reference "AppContext" with no import that binds it (TS2304).`

The fix is almost always to name the type: give the shape an exported alias and annotate with that alias. Named contracts — including aliases of generic instantiations like `type ScopedPlugin = Plugin<AppContext>` — are emitted **by reference** to the alias, so a third-party generic's structural expansion never lands in your generated file. The alternative to this error is a generated file that fails *your* `tsc` instead of ours.

**A class isn't registered** — it needs an `implements` clause of its own. A class that only *inherits* a contract through `extends` is reported with `class_inherited_contract_not_declared`, naming the base and the contract to add. Inheriting a contract deliberately does not inherit registration; see [Class registration](/concepts/classes#the-base-class-pattern).

**Two contracts with the same name** — contract identity is the pair (declaration file, declared name), so two different declarations sharing a name fail generation with both declaration sites named. Rename one.

**Factory destructures `IocGeneratedCradle`** — not allowed. Use a named local deps type instead. The error names the factory and shows the correct pattern; see [Consuming generated types](/reference/generated-types).

**A generated type is referenced in an unsupported form** — `keyof`, `extends`, chained or computed indexed access, re-exports, `typeof import(…)`, and friends are hard errors naming the file, the line, and the supported replacement. The complete list is in [Consuming generated types](/reference/generated-types#rejected-forms). These aren't arbitrary restrictions: each one, left alone, would silently bake the *previous* generation's types into the new output.

**Duplicate registration keys within a manifest** — every implementation needs a globally unique Awilix key. If two units produce the same key, rename the exports or use `registrations[Contract][impl].name` to override.

**Duplicate registration keys across composed manifests** — composition errors with both manifest sources named. Resolve via `registrations[Contract][impl].source` in the app's `ioc.config`.

**Composition refuses a manifest** — schema v3 refuses v2 manifests, as every schema bump has. Regenerate every package with the same ioc-manifest version.

**Overlapping scan directories with different scopes** — if a unit's file matches multiple scan roots that specify different `scope` values, generation fails. Narrow the roots or set lifetimes per implementation in `registrations`.

**`registrations` for unknown contracts** — keys in `registrations` must match a discovered contract type name exactly. In app mode, that includes contracts from composed manifests. A typo fails with a list of what was actually discovered, locally and from composed packages.

**App mode codegen fails to resolve a composed package** — the package needs `./iocManifest` and `./iocTypes` subpath exports in its `package.json`. Until those are added, app codegen can't import the manifest.

**`_<Pkg>ExternalsAssert` fails to compile** — a composed package's externals are not satisfied by the composition. Add a unit in the app (or in another composed package) that supplies the missing key, or compose another manifest that does.

**Group base type mismatch across manifests** — `baseTypeId` is package-relative in v3, so this no longer fires for the common case of the same package reached through different absolute paths. It still fires when the same logical type is genuinely reached through different package layouts — a workspace `src/Storage.ts` build versus a published `dist/Storage.d.ts` one. The error includes the remediation block to paste into `groupBaseTypeAliases`.

**Library-mode invocation of `ioc validate`** — prints an informational message and exits 0. Validate is a cross-manifest tool; a library has no cross-manifest concerns to validate.

**My unit isn't in the group (or didn't get the marker lifetime)** — membership is **nominal**: the contract must declare heritage to the base, via `extends`, an intersection (`type Foo = Bar & YourBase`), or a plain alias (`type Foo = Bar`). Structural similarity is not enough. The common miss is a union: `type Contract = Impl | undefined` will not join a group whose base is `Impl`, because a union is not heritage. Use `interface Contract extends Impl` or drop the union arm.

**A singleton silently reuses a per-request dependency** — if a `singleton` depends (directly or through a chain) on a `scoped` or scope-provided value, it captures one instance at first construction and never refreshes it; per-request state goes stale with no runtime error. `ioc generate` fails on `singleton → scoped` edges for exactly this reason. Make the consumer `scoped`, or mark deliberate cases with `allowLifetimeInversion`. See [Lifetime inversion checks](/concepts/lifetimes#lifetime-inversion-checks).

---
