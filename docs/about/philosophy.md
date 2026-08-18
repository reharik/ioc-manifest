# Design philosophy

This package is **not** an IoC container. It is a codegen layer over Awilix that trades manual registration for convention.

- **Units are plain code.** No decorators, no required base classes, no `RESOLVER` symbols. A factory is an exported function that takes a named deps type and returns a value; a class unit is an ordinary class with an `implements` clause. Both are code you would have written anyway.
- **Policy lives in one file.** Lifetimes, defaults, and key overrides are in `ioc.config.ts` — never scattered across unit sources. Looking at a unit tells you _what_ it builds; looking at the config tells you _how_ it's registered.
- **Contracts are declared at the site and discovered from source.** A unit's contract is the name you wrote at its contract site — a factory's return annotation, a class's `implements` clause — resolved to the declaration it names. There is no central registry to maintain, and no inference from the checker's normalization of your types: what you wrote is what is registered.
- **Library packages own their boundary.** Each package generates its own manifest. What it supplies appears in `IocGeneratedCradle`; what it expects from outside appears in `IocExternals`. The contract is explicit and machine-readable.
- **App-mode composition is set-like.** `registerIocFromManifest(container, [a, b, c])` is order-independent. Conflicts are hard errors with explicit resolution, never silent override.
- **Errors fail fast and explain themselves.** Ambiguous defaults, key collisions, missing externals, and base-type mismatches are caught at generation, validation, or compile time — with messages that name the problem, suggest a fix, and where possible give you the exact config block to paste.
- **Silence means nothing was wrong.** A unit that matched a trigger but could not be registered is never dropped quietly; it is reported with a categorized reason. The corollary matters as much: warnings that fire on correct code get ignored, so a warning has to mean something is actually missing.
- **Static imports, not runtime scanning.** The generated manifest is a plain TypeScript module with static imports. It works in dev with loose source files and in production with a single bundled file — no filesystem walking at runtime.

---

## License

MIT — see [LICENSE](https://github.com/reharik/ioc-manifest/blob/main/LICENSE).
