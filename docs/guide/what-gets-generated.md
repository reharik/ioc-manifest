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

When a package declares `scopeProvided`, those keys are emitted into a separate `IocScopeProvided` interface rather than `IocExternals`, with a JSDoc banner reminding you to register them onto a child scope:

```ts
export interface IocScopeProvided {
  viewerId: string;
}
```

The main manifest file also exports `IOC_SCOPE_PROVIDED_KEYS` (a `readonly` string tuple) so app code can reference the set — for example, to assert a request-scope helper covers the keys the current path resolves. See [`scopeProvided`](/config/reference#scopeprovided).

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
  manifestSchemaVersion: 2,
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
      },
    },
    // ... more contracts ...
  },
} as const satisfies IocGeneratedContainerManifest;
```

---
