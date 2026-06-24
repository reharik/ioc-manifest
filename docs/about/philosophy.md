# Design philosophy

This package is **not** an IoC container. It is a codegen layer over Awilix that trades manual registration for convention.

- **Factories are plain functions.** No decorators, no base classes, no `RESOLVER` symbols. A factory is an exported function that takes a named deps type and returns a value.
- **Policy lives in one file.** Lifetimes, defaults, and key overrides are in `ioc.config.ts` — never scattered across factory sources. Looking at a factory tells you _what_ it builds; looking at the config tells you _how_ it's registered.
- **Types are inferred, not declared.** The generator reads the TypeScript program to discover contracts, dependencies, and assignability. You don't maintain a parallel type registry.
- **Library packages own their boundary.** Each package generates its own manifest. What it supplies appears in `IocGeneratedCradle`; what it expects from outside appears in `IocExternals`. The contract is explicit and machine-readable.
- **App-mode composition is set-like.** `registerIocFromManifest(container, [a, b, c])` is order-independent. Conflicts are hard errors with explicit resolution, never silent override.
- **Errors fail fast and explain themselves.** Ambiguous defaults, key collisions, missing externals, and base-type mismatches are caught at generation, validation, or compile time — with messages that name the problem, suggest a fix, and where possible give you the exact config block to paste.
- **Static imports, not runtime scanning.** The generated manifest is a plain TypeScript module with static imports. It works in dev with loose source files and in production with a single bundled file — no filesystem walking at runtime.

---

## License

MIT — see [LICENSE](https://github.com/reharik/ioc-manifest/blob/main/LICENSE).
