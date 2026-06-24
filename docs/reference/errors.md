# Error handling

Errors are designed to tell you exactly what went wrong and what to do about it.

**Config errors** are prefixed `[ioc-config]` — unknown contracts in `registrations`, duplicate defaults, key collisions. These fail at generation time before any files are written.

**Discovery errors** are prefixed `[ioc]` — duplicate registration keys, unresolvable contract types, overlapping scan directories with conflicting scopes, factories destructuring directly from `IocGeneratedCradle` (use named deps types instead).

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
