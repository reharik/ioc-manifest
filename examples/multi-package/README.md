# Multi-package IoC example

End-to-end demo of **library-mode** manifests (`@example/lib-storage`, `@example/lib-services`) composed by an **app-mode** package (`@example/app`) using `composedManifests`, generated `ioc-composed.ts`, and `registerIocFromManifest` with `composedRegistrationOverrides`.

## How to run it

From the **ioc-manifest repo root**, build the library once (`npm run build`), then:

```bash
npm run example:full
```

Or step by step from the repo root: `example:install`, `example:gen`, `example:typecheck`, `example:start`, `example:typecheck-broken`.

From this directory after a root build: `npm run setup` (prints reminders), `npm install`, `npm run gen`, then `typecheck` / `start`.

## What to look at

- `packages/lib-storage/src/ioc.config.ts` and `packages/lib-services/src/ioc.config.ts` — library mode (no `composedManifests`).
- `packages/app/src/ioc.config.ts` — app mode with `composedManifests` and `registrations.Storage.s3Storage.default: true` (overrides lib-storage’s local default).
- `packages/app/src/generated/ioc-composed.ts` after `npm run gen` — `local` identifier, `as const` manifest array, `AppCradle` intersection, per-key `_IocExpect` externals assertions (`_<Pkg>_<key>Assert`).
- `packages/app/src/factories/buildConfig.ts` and `lib-services` `buildConfigProbe` — subset external: lib-services demands `AppConfigSlice` on key `config`; app supplies full `AppConfig` (extra fields allowed).
- `packages/app/src/bootstrap.ts` — `registerIocFromManifest(container, composedManifests, composedRegistrationOverrides)`.
- `packages/lib-contracts` — shared `LoggingService` base type; `lib-storage` and `lib-services` both declare `groups.loggers` and contribute implementations merged at app composition (see bootstrap output `Loggers in group: ...`).
- `packages/app-externals-broken/` — no local logger factory; typecheck fails at `_LibServicesExternalsAssert` in generated `ioc-composed.ts`. Run `npm run typecheck:broken-expect-fail` (expects failure).

Library `package.json` exports point at `./src/generated/*.ts` because this is a dev workspace; published packages would typically expose `dist/`-compiled paths.
