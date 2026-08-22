/* AUTO-GENERATED. DO NOT EDIT.
Primary container manifest.
Re-run `npm run gen:manifest` after changing factories or IoC config.
*/
import type {
  IocGeneratedContainerManifest,
  IocModuleNamespace,
} from "ioc-manifest";

import * as ioc_ArchiveStorage from "../factories/ArchiveStorage.js";
import * as ioc_buildAuditEventLogger from "../factories/buildAuditEventLogger.js";
import * as ioc_buildLocalStorage from "../factories/buildLocalStorage.js";
import * as ioc_buildS3Storage from "../factories/buildS3Storage.js";
import * as ioc_buildStorageEventLogger from "../factories/buildStorageEventLogger.js";

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
};

export const iocManifest = {
  manifestSchemaVersion: 3,

  moduleImports: [
    ioc_ArchiveStorage,
    ioc_buildAuditEventLogger,
    ioc_buildLocalStorage,
    ioc_buildS3Storage,
    ioc_buildStorageEventLogger,
  ] as const satisfies readonly IocModuleNamespace[],

  contracts: {
    LoggingService: {
      auditEventLogger: {
        exportName: "buildAuditEventLogger",
        registrationKey: "auditEventLogger",
        modulePath: "buildAuditEventLogger.ts",
        relImport: "../factories/buildAuditEventLogger.js",
        contractName: "LoggingService",
        implementationName: "auditEventLogger",
        lifetime: "scoped",
        moduleIndex: 1,
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
        moduleIndex: 4,
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
        moduleIndex: 2,
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
        moduleIndex: 3,
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
} as const satisfies IocGeneratedContainerManifest<IocManifestGroupRoots>;

export const IOC_SCOPE_PROVIDED_KEYS = [] as const;

/* Optional manifest data this file is known to carry in full. A composing app reads it to tell
   "this unit has no dependency keys" apart from "this manifest predates dependency keys". */
export const IOC_MANIFEST_FEATURES = ["dependencyKeys"] as const;
