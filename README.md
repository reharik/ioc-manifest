# ioc-manifest

**Convention-based dependency discovery and codegen for [Awilix](https://github.com/jeffijoe/awilix).** Write factory functions, run the generator, get a fully typed IoC container — no manual registrations. Compose containers across packages in a monorepo with first-class support.

```bash
npm install ioc-manifest
```

## Documentation

Full documentation lives at **[reharik.github.io/ioc-manifest](https://reharik.github.io/ioc-manifest/)**.

- [Introduction](https://reharik.github.io/ioc-manifest/guide/introduction) — the problem, what this does, library vs app mode
- [Quick start](https://reharik.github.io/ioc-manifest/guide/quick-start) — factories → config → generate → bootstrap
- [Core concepts](https://reharik.github.io/ioc-manifest/concepts/conventions) — conventions, [lifetimes](https://reharik.github.io/ioc-manifest/concepts/lifetimes), [groups](https://reharik.github.io/ioc-manifest/concepts/groups)
- [`ioc.config.ts` reference](https://reharik.github.io/ioc-manifest/config/reference) — the single policy surface
- [Cross-package composition](https://reharik.github.io/ioc-manifest/monorepo/composition) — monorepo app mode
- [CLI](https://reharik.github.io/ioc-manifest/reference/cli) · [Error handling](https://reharik.github.io/ioc-manifest/reference/errors) · [Pitfalls](https://reharik.github.io/ioc-manifest/reference/pitfalls)

## What you get

- **Auto-discovery** — export `buildUserService`, it's registered as `userService` returning `UserService`
- **Typed end-to-end** — `container.resolve("userService")` returns `UserService`, not `any`
- **Plural collections** — multiple implementations of a contract get a `ReadonlyArray` key automatically
- **Cross-package composition** — compose manifests across a monorepo with compile-time externals checks
- **Lifetime-inversion safety** — generation fails when a longer-lived service would freeze a shorter-lived dependency
- **No runtime scanning** — output is plain Awilix with static imports; zero lock-in, works in dev and bundled prod

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
