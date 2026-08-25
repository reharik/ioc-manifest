# ioc-manifest

**Convention-based dependency discovery and codegen for [Awilix](https://github.com/jeffijoe/awilix).** Write factory functions or classes; `ioc generate` reads them from source, checks that the wiring holds together, and emits a fully typed container — no manual registrations, no runtime scanning. Scope roots, groups and cross-package composition are first-class, and every one of them is verified at build time.

The approach is loosely inspired by [StructureMap](https://structuremap.github.io/)'s registry scanning conventions from the .NET world — convention over configuration, with a single config file as the policy surface when you need to override defaults.

```bash
npm install ioc-manifest
```

## A minimal example

Two ways to declare a registration unit, one set of rules behind them:

```ts
// A factory: the `build` prefix is the trigger, the return annotation is the contract.
export const buildS3MediaStorage = ({ logger }: S3MediaStorageDeps): MediaStorage => ({ ... });

// A class: the `implements` clause is both the trigger and the contract.
export class S3MediaStorage implements MediaStorage { ... }
```

Both register as `s3MediaStorage` supplying `MediaStorage`. A consumer declares which of five things each dependency is — and the two that matter first are the contract's elected default, and one specific implementation:

```ts
import type { Named } from "ioc-manifest";

type UploadServiceDeps = {
  mediaStorage: MediaStorage;                 // whichever implementation is elected
  s3MediaStorage: Named<MediaStorage>;        // that one, pinned
};
```

Point `ioc.config.ts` at your source, run the generator, and hand the result to Awilix:

```bash
npx ioc generate
```

```ts
import { createContainer, InjectionMode } from "awilix";
import { registerIocFromManifest } from "ioc-manifest";
import { iocManifest } from "./generated/ioc-manifest.js";
import type { IocGeneratedCradle } from "./generated/ioc-registry.types.js";

const container = createContainer<IocGeneratedCradle>({
  injectionMode: InjectionMode.PROXY,
});
registerIocFromManifest(container, [iocManifest]);

const uploadService = container.resolve("uploadService"); // typed, not `any`
```

## Documentation

Full documentation lives at **[reharik.github.io/ioc-manifest](https://reharik.github.io/ioc-manifest/)**.

- **[How it fits together](https://reharik.github.io/ioc-manifest/guide/how-it-fits-together)** — the whole pipeline on one page. Start here.
- **[Quick start](https://reharik.github.io/ioc-manifest/guide/quick-start)** — units → config → generate → bootstrap, in a few minutes.
- **[Adopting on an existing codebase](https://reharik.github.io/ioc-manifest/guide/adopting)** — why the first run is red, and how to read it.

## Working on ioc-manifest

The test suite runs in two lanes.

```bash
npm run test:fast   # ~6s, 568 tests — everything that builds no TypeScript program
npm test            # the whole suite; what CI runs
```

**Iterate on `test:fast`; run the full suite before you report anything.** `test:fast` is the
non-`*.integration.test.ts` glob, and what earns a file the `.integration` suffix is mechanism, not
taste: a test that builds a TypeScript program, spawns a subprocess, or runs codegen belongs in the
slow lane, because every one of those costs seconds. `src/test-support/testLaneSeam.test.ts`
enforces that in both directions — it fails on a fast-lane file that can reach any of the three, and
on an `.integration` file that can reach none of them — so the suffix cannot quietly stop being
true. When it fails, the fix is a rename, and the message says which way.

The rest of the checks:

```bash
npm run typecheck   # tsc --noEmit
npm run build       # dist/
npm run gen:manifest && git diff --exit-code src/generated   # generated-diff must be zero
npm run example:full                                          # the multi-package example, end to end
```

## Contributing to the docs

The docs are a [VitePress](https://vitepress.dev/) site under `docs/`.

```bash
npm run docs:dev      # local dev server with hot reload
npm run docs:build    # production build
npm run docs:preview  # preview the production build
```

Pushing changes under `docs/` to `main` deploys to GitHub Pages via `.github/workflows/deploy-docs.yml`.

## License

MIT — see [LICENSE](./LICENSE).
