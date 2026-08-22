# What gets generated

Here's what library-mode output looks like for a small app. You never edit these files — they're regenerated from source.

**`ioc-registry.types.ts`** — the typed cradle and externals:

```ts
/* AUTO-GENERATED. DO NOT EDIT. */
import type { Logger } from "../services/buildConsoleLogger.js";
import type { MediaStorage } from "../services/buildLocalMediaStorage.js";
import type { UserService } from "../services/buildUserService.js";
import type { Database } from "../types/Database.js";

export interface IocGeneratedCradle {
  logger: Logger;
  mediaStorage: MediaStorage;
  userService: UserService;
}

export interface IocExternals {
  database: Database;
}
```

`IocExternals` lists every dependency the package consumes from outside — keys destructured by factory deps types where no local factory supplies them. `IocGeneratedCradle` contains only what the package itself supplies. The two interfaces together describe the package's full contract: what it provides and what it needs.

`IocGeneratedCradle` carries three kinds of key: each implementation's own registration key, each group root key, and each contract's **slot key** — the camel-cased contract name (or a configured `$contract.accessKey`) under which the contract's elected default is reachable. A slot key is typed as the *contract*, because it means "whichever implementation is elected". A contract that elects no default has no slot key at all. Which of them a dependency wants is declared at the deps site; see [Demanding a dependency](/concepts/conventions#demanding-a-dependency-the-five-things-a-deps-property-can-be).

When a package declares `scopeProvided`, those keys are emitted into a separate `IocScopeProvided` interface rather than `IocExternals`, with a JSDoc banner reminding you to register them onto a child scope:

```ts
export interface IocScopeProvided {
  viewerId: string;
}
```

The main manifest file also exports `IOC_SCOPE_PROVIDED_KEYS` (a `readonly` string tuple) so app code can reference the set — for example, to assert a request-scope helper covers the keys the current path resolves. See [`scopeProvided`](/config/reference#scopeprovided).

If the package declares [groups](/concepts/groups), each group's aggregate type is also exported as a named alias (the access key in PascalCase — `channels` → `export type Channels = …`), so factories can import the group type directly instead of indexing `IocGeneratedCradle`.

**`ioc-manifest.ts`** — the registration data:

```ts
/* AUTO-GENERATED. DO NOT EDIT. */
import type {
  IocGeneratedContainerManifest,
  IocModuleNamespace,
} from "ioc-manifest";

import * as ioc_services_buildConsoleLogger from "../services/buildConsoleLogger.js";
import * as ioc_services_buildLocalMediaStorage from "../services/buildLocalMediaStorage.js";
// ... more imports ...

export const iocManifest = {
  manifestSchemaVersion: 3,
  moduleImports: [
    /* ... */
  ] as const satisfies readonly IocModuleNamespace[],
  contracts: {
    Logger: {
      consoleLogger: {
        exportName: "buildConsoleLogger",
        registrationKey: "consoleLogger",
        contractName: "Logger",
        implementationName: "consoleLogger",
        lifetime: "singleton",
        moduleIndex: 0,
        default: true,
        discoveredBy: "naming",
        dependencyKeys: ["config"],
      },
    },
    MediaStorage: {
      archiveMediaStorage: {
        kind: "class",
        exportName: "ArchiveMediaStorage",
        registrationKey: "archiveMediaStorage",
        contractName: "MediaStorage",
        implementationName: "archiveMediaStorage",
        lifetime: "singleton",
        moduleIndex: 1,
        discoveredBy: "implements",
      },
    },
    // ... more contracts ...
  },
} as const satisfies IocGeneratedContainerManifest;
```

`dependencyKeys` records the cradle keys a unit destructures out of its deps parameter. It exists for **composing apps**: a manifest is all a consumer ever sees of a library, so without the keys a composed unit is a dead end in any demand walk — which is how a scope root whose subtree runs through a composed package used to miss every late-bound value that subtree demands. It is omitted when a unit demands nothing, and omitted entirely for a deps parameter that is not a top-level object binding pattern (the same "prefer omission" rule `dependencyContractNames` follows). Because absence is therefore ambiguous, the manifest also exports `IOC_MANIFEST_FEATURES` — a sibling export, not a manifest property, so that older runtimes (which read every unrecognized top-level manifest property as a group root) are unaffected:

```ts
export const IOC_MANIFEST_FEATURES = ["dependencyKeys"] as const;
```

A composed manifest without that export predates the field, and a consuming app says so out loud rather than reporting a confident verdict over a subtree it could not walk.

`kind: "class"` is emitted only for [class units](/concepts/classes); its absence reads as `"factory"`. That matches how every other conventional value here (`default`, `accessKey`, `discoveredBy`) stays out of the output rather than being restated on every entry — and since schema v3 refuses v2 manifests outright, there is no cross-version reader to consider, so the smaller diff wins.

At runtime a class unit registers as `asFunction(cradle => new Ctor(cradle))` — behaviorally equivalent to `asClass` under PROXY injection, but routed through the shared wrapper so class units get the same [resolution diagnostics](/reference/errors) as factories.

## Group base type identifiers

When a package declares [groups](/concepts/groups), the manifest carries an opaque `baseTypeId` per group — the canonical identity of its base type, used to merge groups across composed manifests:

```ts
baseTypeId: "@acme/contracts/src/types/Storage.ts:Storage";
```

The form is `<packageName>/<path within that package>:<TypeName>`: the package name comes from the nearest enclosing `package.json`, and the path is POSIX-relative to it. It's **machine-independent** — identical on every developer's checkout and in CI, which it was not in v2, when it was an absolute filesystem path. See [`groupBaseTypeAliases`](/monorepo/composition#groups-across-manifests) for the narrow case that still needs an equivalence declaration.

---
