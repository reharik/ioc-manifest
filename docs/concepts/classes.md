# Class registration

An exported class with an `implements` clause is a registration unit. The `implements` clause is its contract site — the same declared, syntactic position a factory's return type annotation occupies, read by the same resolver, producing the same contract identity.

One identity rule, two unit kinds. Everything downstream is shared: keys, default election, group and marker membership, dependency analysis, lifetime checks, composition.

## Side by side

The same service, written both ways:

::: code-group

```ts [Factory]
import type { MediaStorage } from "./contracts.js";
import type { Logger } from "./Logger.js";

type S3MediaStorageDeps = {
  logger: Logger;
};

export const buildS3MediaStorage = ({
  logger,
}: S3MediaStorageDeps): MediaStorage => ({
  label: "s3",
  put: async (key) => {
    logger.log(`stored ${key}`);
  },
});
```

```ts [Class]
import type { MediaStorage } from "./contracts.js";
import type { Logger } from "./Logger.js";

type S3MediaStorageDeps = {
  logger: Logger;
};

export class S3MediaStorage implements MediaStorage {
  label = "s3";
  readonly #logger: Logger;

  constructor({ logger }: S3MediaStorageDeps) {
    this.#logger = logger;
  }

  async put(key: string): Promise<void> {
    this.#logger.log(`stored ${key}`);
  }
}
```

:::

Both register under the key `s3MediaStorage`, supplying the contract `MediaStorage`, consuming `logger`. Nothing else in your configuration or bootstrap changes. Choose per service; the two mix freely in one package, and a class and a factory can implement the same contract and compete for its default like any two implementations.

## The trigger

`implements` is to a class what the `build` prefix is to a factory: a deliberate, local mark that says "register this."

```ts
export class PlainHelper { }                        // ordinary code, never reported
export class S3MediaStorage implements MediaStorage { }  // a registration unit
```

A class without `implements` is ordinary code. It produces no error, no warning, and no entry in the discovery report — exactly like a function that doesn't start with `build`.

Making the trigger explicit rather than structural is what keeps "is this registered?" answerable at the declaration. You never have to trace a heritage chain across files to find out.

## Dependencies

Dependencies come from the constructor's **single destructured object parameter**, typed with a named deps type — the same rule factories follow, for the same reasons:

```ts
type UploadServiceDeps = {
  mediaStorage: MediaStorage;
  logger: Logger;
};

export class UploadService implements Uploader {
  constructor({ mediaStorage, logger }: UploadServiceDeps) { ... }
}
```

No constructor, or a zero-parameter constructor, means no dependencies.

This is PROXY-mode injection: the container passes the cradle as one object argument. Anything that isn't one object parameter is a hard error naming the class — several parameters, a rest parameter, a parameter property (`constructor(private readonly logger: Logger)`), or a primitive/array/function parameter type. Those are CLASSIC-mode parameter-name injection, which this library does not support.

## Keys

The registration key is the camelCased class name, using Awilix's own algorithm:

| Class            | Key              |
| ---------------- | ---------------- |
| `MediaStorage`   | `mediaStorage`   |
| `S3MediaStorage` | `s3MediaStorage` |
| `APIClient`      | `apiClient`      |
| `HTTPSProxy`     | `httpsProxy`     |

Note the acronym handling: `APIClient` splits as `API|Client` → `apiClient`. Factory export names use the same rule, so the key doesn't depend on which unit kind you picked. Override with `registrations[Contract][implementation].name` as usual.

### The `loadModules` file-name warning

Awilix's `loadModules` keys on the **file name**; ioc-manifest keys on the **class name**. In one-class-per-file codebases these agree, and kebab or snake file names that camelCase to the same key are fine. When they differ, generation says so:

```
[ioc] class "S3MediaStorage" in "storage.ts" registers as "s3MediaStorage".
Awilix loadModules would have keyed this file as "storage".
```

Suppress per class once you've confirmed the key:

```ts
classes: {
  S3MediaStorage: { allowDivergentFileName: true },
},
```

## Groups and lifetime markers

Class units participate exactly as factories do. Membership is nominal — resolved from the contract named in the `implements` clause:

```ts
export interface AuditedService extends IScoped {}          // lifetime marker
export interface RequestAuditor extends Auditor, IScoped {} // contract carrying it

export class RequestAuditorImpl implements RequestAuditor { ... }  // → scoped
```

A class joins a collection or object group when its contract declares heritage to the group's base type, alongside factory members in the same group.

## The base-class pattern

An abstract base may carry `implements`, and shared behaviour belongs there. **Each concrete class restates the contract to register:**

```ts
export abstract class StorageBase implements MediaStorage {
  abstract label: string;
  async put(key: string): Promise<void> { ... }
}

export class S3Storage extends StorageBase implements MediaStorage {
  label = "s3";
}

export class LocalStorage extends StorageBase implements MediaStorage {
  label = "local";
}
```

Abstract classes cannot be constructed, so they are never registration units. `implements` on the base is a type assertion — "subclasses of me satisfy this" — not a registration.

**Inheriting a contract does not inherit registration.** This is a decision, not a gap. The trigger stays local and explicit so that reading a class tells you whether it registers, without following `extends` into another file. The cost is one repeated clause per concrete class; the benefit is that the answer is always where you're looking.

Two diagnostics keep that decision from costing you a registration:

**A concrete class that inherits a contract but declares no `implements`** is almost certainly an oversight, so generation names it, its base, the contract, and the fix:

```
[ioc] 1 concrete class(es) inherit a contract but declare no `implements`, so they were NOT registered:
  - src/storage/ArchiveStorage.ts class "ArchiveStorage" extends StorageBase, which declares
    `implements MediaStorage`. Add `implements MediaStorage` to ArchiveStorage to register it.
```

It also appears in `ioc inspect --discovery` under `class_inherited_contract_not_declared`. It is a warning, never fatal — deliberately unregistered subclasses are legitimate, and nothing needs to change for them.

**An abstract class whose contract nothing concrete registers** warns too, because that usually means the concrete subclass is missing its `implements`:

```
[ioc] 1 abstract class(es) declare a contract that no concrete class registers:
  - src/storage/StorageBase.ts class "StorageBase" declares `implements MediaStorage`,
    and nothing concrete registers MediaStorage
```

When a concrete class does register the contract — the normal case above — this stays silent.

## Several `implements` entries

A registration unit has exactly one contract. A class listing two is a hard error naming both, resolvable in config:

```ts
classes: {
  DualUnit: { contract: "Auditor" },
},
```

## How a class is registered

Class units register as `asFunction(cradle => new Ctor(cradle))`.

Under PROXY injection this is behaviorally equivalent to `asClass(Ctor, { injectionMode: PROXY })` — that is exactly what `asClass` does — but routing it through the shared factory wrapper means class units get the same resolution diagnostics as factories. `asClass` offers no error hook, so a class registered through it would resolve outside the instrumented path: no manifest-aware frames in the resolution chain, and a raw `AwilixResolutionError` escaping a root resolve instead of an [`IocResolutionError`](/reference/errors).

The output is still ordinary Awilix. If you eject the generated manifest, `asFunction(cradle => new Ctor(cradle))` is a line you'd have been happy to write by hand.

---
