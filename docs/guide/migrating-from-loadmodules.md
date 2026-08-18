# Migrating from Awilix `loadModules`

If you already drop classes into `services/` and let Awilix find them, this is the closest thing in the library to what you're doing — with the scanning moved from runtime to build time.

```ts
// before
const container = createContainer({ injectionMode: InjectionMode.PROXY });
container.loadModules(["src/services/*.js"], { formatName: "camelCase" });
```

```ts
// after
const container = createContainer<IocGeneratedCradle>({
  injectionMode: InjectionMode.PROXY,
});
registerIocFromManifest(container, [iocManifest]);
```

## What stays the same

**Your container is still Awilix.** The generated manifest is a plain TypeScript module; `registerIocFromManifest` calls `container.register` with ordinary resolvers. There is no proxy layer, no custom container, and nothing to un-adopt: if you ever want out, the generated file is the registration code you'd have written, and you can commit it and delete the tool.

**PROXY injection is unchanged.** Classes take the cradle as one object argument, same as `loadModules` under PROXY mode.

**Keys mostly land where they already are.** The key derivation is Awilix's own `formatName: "camelCase"` algorithm, ported line for line — see the divergence warning below for the one case it differs.

## What changes

**Registration becomes explicit at the class.** `loadModules` registers whatever the glob catches. Here, a class registers because it declares `implements SomeContract`:

```ts
// registered as `userService`, supplying the contract `UserService`
export class UserService implements UserServiceContract { ... }
```

If your services already implement interfaces, this is often a no-op. If they don't, you'll add one clause per class — and in exchange the container becomes typed, because the contract is what the cradle key resolves to.

See [Class registration](/concepts/classes) for the full convention.

**Keys come from the class name, not the file name.** This is the one real divergence, and generation warns about it rather than letting you find out at runtime:

```
[ioc] class "S3MediaStorage" in "storage.ts" registers as "s3MediaStorage".
Awilix loadModules would have keyed this file as "storage".
```

In one-class-per-file codebases the two agree, and separator-cased file names (`s3-media-storage.ts`, `s3_media_storage.ts`) camelCase to the same key, so they're silent. Where they genuinely differ, either rename the file, pin the old key with `registrations[Contract][impl].name: "storage"`, or accept the new one and silence the warning with `classes: { S3MediaStorage: { allowDivergentFileName: true } }`.

## What build-time generation buys you

**A typed cradle.** `container.resolve("userService")` returns `UserService`, not `any`. With `loadModules` the only way to get this is to hand-maintain a cradle interface that drifts from the glob.

**Wiring validated at generate time.** Missing dependencies, ambiguous defaults, key collisions, and [lifetime inversions](/concepts/lifetimes#lifetime-inversion-checks) are found when you generate — not on the first request that resolves that path in production. A `singleton` that depends on a `scoped` repository fails generation instead of quietly serving one request's transaction forever.

**Bundler-safe static imports.** `loadModules` does runtime `require` of globbed paths, which bundlers cannot follow — hence the third-party shims that exist purely to make it work under Vite and webpack. The generated manifest imports every module statically, so it bundles like any other code and works identically in dev and in a single bundled file.

**No filesystem at runtime.** Nothing walks directories at boot.

## Migrating incrementally

You do not have to convert everything at once, and you do not have to choose one unit kind. A package can hold classes and `build*` factories together; they interoperate completely, including competing for the same contract's default. Convert the services you touch, leave the rest, and let the generator report what it found with `ioc inspect --discovery`.

---
