# Dev and production builds

Getting an IoC container to work across development (loose TypeScript source files) and production (a bundled single-file build) is a real headache. `ioc-manifest` handles both cases because the generated manifest uses static `import * as ...` statements rather than runtime filesystem scanning.

In **development**, the generator discovers factories from your TypeScript source tree and emits relative imports that point to your `.ts` files (via `.js` extensions for ESM). Everything resolves naturally through your dev toolchain (tsx, ts-node, etc.).

In **production**, if you bundle your app into a single file (esbuild, rollup, etc.), those same static imports get resolved and inlined by the bundler. The manifest doesn't do any filesystem scanning at runtime — it's just a data structure with pre-resolved imports. Your bundler treats it like any other module graph.

This was a deliberate design choice (and a painful one to get right). There's no `loadModules` glob at runtime, no dynamic `require`, no filesystem walking. The generated manifest is a plain TypeScript module that any bundler can tree-shake and inline.

---
