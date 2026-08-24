/* AUTO-GENERATED. DO NOT EDIT.
Primary container manifest.
Re-run `npm run gen:manifest` after changing factories or IoC config.
*/
import type {
  IocGeneratedContainerManifest,
  IocModuleNamespace,
} from "ioc-manifest";

import * as ioc_ArchiveStorage from "../factories/ArchiveStorage.js";
import * as ioc_buildAddComment from "../factories/buildAddComment.js";
import * as ioc_buildAuditEventLogger from "../factories/buildAuditEventLogger.js";
import * as ioc_buildLocalStorage from "../factories/buildLocalStorage.js";
import * as ioc_buildS3Storage from "../factories/buildS3Storage.js";
import * as ioc_buildStorageEventLogger from "../factories/buildStorageEventLogger.js";
import * as ioc_buildToggleReaction from "../factories/buildToggleReaction.js";

type IocManifestGroupRoots = {
  readonly loggers: {
    readonly kind: "collection";
    readonly baseType: "LoggingService";
    readonly baseTypeId: "@example/lib-contracts/src/types/LoggingService.ts:LoggingService";
    readonly members: readonly [
      {
        readonly contractName: "LoggingService";
        readonly registrationKey: "auditEventLogger";
      },
      {
        readonly contractName: "LoggingService";
        readonly registrationKey: "storageEventLogger";
      },
    ];
  };
  readonly writeServices: {
    readonly kind: "object";
    readonly baseType: "WriteService";
    readonly baseTypeId: "@example/lib-contracts/src/types/WriteService.ts:WriteService";
    readonly members: {
      readonly addComment: {
        readonly contractName: "AddComment";
        readonly registrationKey: "addComment";
      };
      readonly toggleReaction: {
        readonly contractName: "ToggleReaction";
        readonly registrationKey: "toggleReaction";
      };
    };
  };
};

export const iocManifest = {
  manifestSchemaVersion: 3,

  moduleImports: [
    ioc_ArchiveStorage,
    ioc_buildAddComment,
    ioc_buildAuditEventLogger,
    ioc_buildLocalStorage,
    ioc_buildS3Storage,
    ioc_buildStorageEventLogger,
    ioc_buildToggleReaction,
  ] as const satisfies readonly IocModuleNamespace[],

  contracts: {
    AddComment: {
      addComment: {
        exportName: "buildAddComment",
        registrationKey: "addComment",
        modulePath: "buildAddComment.ts",
        relImport: "../factories/buildAddComment.js",
        contractName: "AddComment",
        implementationName: "addComment",
        lifetime: "singleton",
        moduleIndex: 1,
        discoveredBy: "naming",
        dependencyKeys: ["writeServices"],
      },
    },
    LoggingService: {
      auditEventLogger: {
        exportName: "buildAuditEventLogger",
        registrationKey: "auditEventLogger",
        modulePath: "buildAuditEventLogger.ts",
        relImport: "../factories/buildAuditEventLogger.js",
        contractName: "LoggingService",
        implementationName: "auditEventLogger",
        lifetime: "scoped",
        moduleIndex: 2,
        discoveredBy: "naming",
      },
      storageEventLogger: {
        exportName: "buildStorageEventLogger",
        registrationKey: "storageEventLogger",
        modulePath: "buildStorageEventLogger.ts",
        relImport: "../factories/buildStorageEventLogger.js",
        contractName: "LoggingService",
        implementationName: "storageEventLogger",
        lifetime: "scoped",
        moduleIndex: 5,
        discoveredBy: "naming",
      },
    },
    Storage: {
      archiveStorage: {
        kind: "class",
        exportName: "ArchiveStorage",
        registrationKey: "archiveStorage",
        modulePath: "ArchiveStorage.ts",
        relImport: "../factories/ArchiveStorage.js",
        contractName: "Storage",
        implementationName: "archiveStorage",
        lifetime: "singleton",
        moduleIndex: 0,
        discoveredBy: "implements",
        dependencyContractNames: ["Storage"],
        dependencyKeys: ["localStorage"],
      },
      localStorage: {
        exportName: "buildLocalStorage",
        registrationKey: "localStorage",
        modulePath: "buildLocalStorage.ts",
        relImport: "../factories/buildLocalStorage.js",
        contractName: "Storage",
        implementationName: "localStorage",
        lifetime: "singleton",
        moduleIndex: 3,
        default: true,
        discoveredBy: "naming",
        configOverridesApplied: ["default"],
      },
      s3Storage: {
        exportName: "buildS3Storage",
        registrationKey: "s3Storage",
        modulePath: "buildS3Storage.ts",
        relImport: "../factories/buildS3Storage.js",
        contractName: "Storage",
        implementationName: "s3Storage",
        lifetime: "singleton",
        moduleIndex: 4,
        discoveredBy: "naming",
      },
    },
    ToggleReaction: {
      toggleReaction: {
        exportName: "buildToggleReaction",
        registrationKey: "toggleReaction",
        modulePath: "buildToggleReaction.ts",
        relImport: "../factories/buildToggleReaction.js",
        contractName: "ToggleReaction",
        implementationName: "toggleReaction",
        lifetime: "singleton",
        moduleIndex: 6,
        discoveredBy: "naming",
      },
    },
  },
  // loggers
  loggers: {
    kind: "collection",
    baseType: "LoggingService",
    baseTypeId:
      "@example/lib-contracts/src/types/LoggingService.ts:LoggingService",
    members: [
      {
        contractName: "LoggingService",
        registrationKey: "auditEventLogger",
      },
      {
        contractName: "LoggingService",
        registrationKey: "storageEventLogger",
      },
    ],
  },

  // writeServices
  writeServices: {
    kind: "object",
    baseType: "WriteService",
    baseTypeId: "@example/lib-contracts/src/types/WriteService.ts:WriteService",
    members: {
      addComment: {
        contractName: "AddComment",
        registrationKey: "addComment",
      },
      toggleReaction: {
        contractName: "ToggleReaction",
        registrationKey: "toggleReaction",
      },
    },
  },
} as const satisfies IocGeneratedContainerManifest<IocManifestGroupRoots>;

export const IOC_SCOPE_PROVIDED_KEYS = [] as const;

/* Optional manifest data this file is known to carry in full. A composing app reads it to tell
   "this unit has no dependency keys" apart from "this manifest predates dependency keys". */
export const IOC_MANIFEST_FEATURES = ["dependencyKeys"] as const;
