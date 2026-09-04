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

`dependencyKeys` records the cradle keys a unit destructures out of its deps parameter. It exists for **composing apps**: a manifest is all a consumer ever sees of a library, so without the keys a composed unit is a dead end in any demand walk — which is how a scope root whose subtree runs through a composed package used to miss every late-bound value that subtree demands. It is omitted when a unit demands nothing, and omitted entirely for a deps parameter that is not a top-level object binding pattern (the same "prefer omission" rule `dependencyContractNames` follows). Absence is therefore ambiguous, which is what [manifest feature tokens](#manifest-feature-tokens) exist to resolve.

`lifetimeSource` is on the same footing, for the same reason. It records **which mechanism decided** a unit's lifetime — `lifetime-marker`, `group-base-marker`, `factory-config`, `discovery-root`, or `default` (see [lifetime provenance](/concepts/lifetimes#lifetime-provenance)) — so that `ioc explain` in a composing app can answer "why is this scoped" about a unit whose sources are in another package. It is omitted for a unit whose plan carried none, and a manifest that does not declare the feature gets the honest degraded answer rather than a guess.

`kind: "class"` is emitted only for [class units](/concepts/classes); its absence reads as `"factory"`. That matches how every other conventional value here (`default`, `accessKey`, `discoveredBy`) stays out of the output rather than being restated on every entry — and since schema v3 refuses v2 manifests outright, there is no cross-version reader to consider, so the smaller diff wins.

At runtime a class unit registers as `asFunction(cradle => new Ctor(cradle))` — behaviorally equivalent to `asClass` under PROXY injection, but routed through the shared wrapper so class units get the same [resolution diagnostics](/reference/errors) as factories.

## Manifest feature tokens

Every optional field in a manifest is omitted when it is empty, so absence never distinguishes "there is none" from "the generator that wrote this file did not know about the field". For a field a composing app reasons about, that is the difference between a real verdict and a blind one. So a manifest declares positively what it carries, in a **sibling export** — deliberately not a property of `iocManifest`, because every unrecognized top-level property of that object is read back as a group root, by this runtime and by every earlier one:

```ts
export const IOC_MANIFEST_FEATURES = [
  "dependencyKeys",
  "dependencyKeysComplete",
  "lifetimeSource",
] as const;
```

This vocabulary is a **published contract**: other packages' manifests are read against it, so a token means the same thing in every file that carries it and a reader that honours one must go on honouring it. The list emitted is computed **per manifest** — a *capability* token is unconditional, a *coverage* token is earned.

| token | kind | what it claims |
| --- | --- | --- |
| `dependencyKeys` | capability | This manifest's generator knows the `dependencyKeys` field and emits it wherever it has keys to emit. Nothing more. Every manifest this generator has ever written can say it honestly. |
| `dependencyKeysComplete` | coverage | Every unit reaching `contracts` had its demand set actually **determined** at generation. On such a manifest, an absent `dependencyKeys` means "demands nothing" and nothing else. Computed per manifest: one factory whose deps parameter could not be read withholds it for the whole package. |
| `lifetimeSource` | capability | This manifest's generator knows the `lifetimeSource` field and emits it for every unit whose plan carried provenance. |

The distinction is not pedantry. `dependencyKeys` is derived syntactically, from a destructured first parameter and nothing else, so a factory written `(deps: Deps)` — idiomatic, and not a mistake — records no keys while demanding plenty, and is indistinguishable in the file from a unit that demands nothing. Only `dependencyKeysComplete` rules that out, which makes it the one token that licenses a consumer to walk a subtree through this package and call the result complete. Without it, an app's [scope-root verification](/concepts/scope-roots#composed-blind-spots) reports the blind spot beside its verdict instead of claiming coverage it does not have.

`lifetimeSource` has no coverage sibling because it needs none: provenance resolution cannot come up empty the way key extraction can — it ends at `default`, which is a real answer meaning "nothing declared one" — so on every manifest this generator writes, absence means the file predates the field. A second token there would carry no information, and a published vocabulary should not grow tokens that carry none.

### Why two tokens rather than one conditional token

The obvious alternative is to keep one token and emit it only when coverage is complete. It does not work, for a reason that has nothing to do with which design is tidier: **manifests already on disk declare `dependencyKeys` unconditionally and cannot take it back.** Making the existing token conditional would leave every published manifest trusted until the day its own package regenerates, with no way for a consumer to tell which files were vouching for coverage and which were merely announcing a field.

A token no old manifest can emit inverts that. The consumer stops being falsely confident on its **next run**, rather than on the day every producer it depends on happens to upgrade. `dependencyKeys` is read as the capability claim it always truthfully was; `dependencyKeysComplete` carries the claim that was previously being made without being checked.

### `dependencyKeyCoverage` does not move the token

The [`dependencyKeyCoverage`](/config/reference#dependencykeycoverage) setting governs how loudly the producing package reports its own unreadable factories — `"warn"` (default), `"error"`, or `"off"`. It does not affect what the manifest declares. **The token follows the code, not the setting**: `"off"` silences the message and the package still withholds `dependencyKeysComplete`, because the units whose demands could not be read are still there and every consumer still has to know.

## Group base type identifiers

When a package declares [groups](/concepts/groups), the manifest carries an opaque `baseTypeId` per group — the canonical identity of its base type, used to merge groups across composed manifests:

```ts
baseTypeId: "@acme/contracts/src/types/Storage.ts:Storage";
```

The form is `<packageName>/<path within that package>:<TypeName>`: the package name comes from the nearest enclosing `package.json`, and the path is POSIX-relative to it. It's **machine-independent** — identical on every developer's checkout and in CI, which it was not in v2, when it was an absolute filesystem path. See [`groupBaseTypeAliases`](/monorepo/composition#groups-across-manifests) for the narrow case that still needs an equivalence declaration.

---
