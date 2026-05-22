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
- `packages/app/src/generated/ioc-composed.ts` after `npm run gen` — `local` identifier, `as const` manifest array, `AppCradle` intersection, `_IocExpect` externals assertions.
- `packages/app/src/bootstrap.ts` — `registerIocFromManifest(container, composedManifests, composedRegistrationOverrides)`.
- `packages/app-externals-broken/` — no local logger; composes `externals-probe` so typecheck fails at `_ExternalsProbeExternalsAssert`. Run `npm run typecheck:broken-expect-fail` (expects failure).

Library `package.json` exports point at `./src/generated/*.ts` because this is a dev workspace; published packages would typically expose `dist/`-compiled paths.
