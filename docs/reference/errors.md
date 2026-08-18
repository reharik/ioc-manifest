# Error handling

Errors are designed to tell you exactly what went wrong and what to do about it.

**Config errors** are prefixed `[ioc-config]` — unknown contracts in `registrations`, duplicate defaults, key collisions. These fail at generation time before any files are written.

**Discovery errors** are prefixed `[ioc]` — missing return type annotations, contract sites that aren't named types, two contract declarations sharing a name, classes listing several `implements` entries or carrying a non-injectable constructor, duplicate registration keys, overlapping scan directories with conflicting scopes, and factories destructuring directly from `IocGeneratedCradle` (use named deps types instead). Discovery aggregates by category: one run reports every offending export, not the first.

**Generated-reference errors** are prefixed `[ioc]` and name the file, the line, the offending source text, why the form can't be supported, and the supported replacement. See [Consuming generated types](/reference/generated-types#rejected-forms).

**Discovery warnings** are prefixed `[ioc]` and never block generation. They cover units that matched a trigger but couldn't be used, concrete classes that inherit a contract without declaring `implements`, abstract classes declaring a contract nothing concrete registers, divergent single-implementation names, and class file names that would have keyed differently under Awilix `loadModules`. `ioc inspect --discovery` shows the same findings per export, with a categorized reason.

**Validation errors** are prefixed by category (`[externals]`, `[same-key-conflict]`, `[group-base-type]`, etc.) and emitted by `ioc validate`. Validate aggregates: a failing run reports every issue at once, not just the first.

**Runtime resolution errors** use `IocResolutionError` with structured dependency chains:

```
[ioc] Cannot build AlbumService using implementation albumService.

Resolution chain:
  AlbumService (albumService) [services/buildAlbumService.ts]
    -> MediaStorage (s3MediaStorage) [services/buildS3MediaStorage.ts]
      -> S3Client ✖ no registered implementation
```

Missing dependencies, cyclic references, lifetime violations, and factory exceptions are all caught and reported with the full resolution path.

A missing **scope-provided** value surfaces here too: resolving a service whose scope value wasn't registered produces a `no registered implementation` leaf for that key. If you see this for a key declared in `scopeProvided`, the fix is to register it onto the child scope before resolving — not to add a factory.

---
