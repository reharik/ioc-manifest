/* AUTO-GENERATED. DO NOT EDIT.
Primary container manifest.
Re-run `npm run gen:manifest` after changing factories or IoC config.
*/
import type {
  IocGeneratedContainerManifest,
  IocModuleNamespace,
} from "ioc-manifest";

import * as ioc_buildLocalStorage from "../factories/buildLocalStorage.js";
import * as ioc_buildS3Storage from "../factories/buildS3Storage.js";
import * as ioc_buildStorageEventLogger from "../factories/buildStorageEventLogger.js";

type IocManifestGroupRoots = {
  readonly loggers: {
    readonly kind: "collection";
    readonly baseType: "LoggingService";
    readonly baseTypeId: "/home/reharik/Development/ioc-manifest/examples/multi-package/packages/lib-contracts/src/types/LoggingService.ts:LoggingService";
    readonly members: readonly [
      {
        readonly contractName: "LoggingService";
        readonly registrationKey: "storageEventLogger";
      },
    ];
  };
  readonly storages: {
    readonly kind: "collection";
    readonly baseType: "Storage";
    readonly baseTypeId: "/home/reharik/Development/ioc-manifest/examples/multi-package/packages/lib-storage/src/types/Storage.ts:Storage";
    readonly members: readonly [
      {
        readonly contractName: "Storage";
        readonly registrationKey: "localStorage";
      },
      {
        readonly contractName: "Storage";
        readonly registrationKey: "s3Storage";
      },
    ];
  };
};

export const iocManifest = {
  manifestSchemaVersion: 2,

  moduleImports: [
    ioc_buildLocalStorage,
    ioc_buildS3Storage,
    ioc_buildStorageEventLogger,
  ] as const satisfies readonly IocModuleNamespace[],

  contracts: {
    LoggingService: {
      storageEventLogger: {
        exportName: "buildStorageEventLogger",
        registrationKey: "storageEventLogger",
        modulePath: "buildStorageEventLogger.ts",
        relImport: "../factories/buildStorageEventLogger.js",
        contractName: "LoggingService",
        implementationName: "storageEventLogger",
        lifetime: "singleton",
        moduleIndex: 2,
        discoveredBy: "naming",
      },
    },
    Storage: {
      localStorage: {
        exportName: "buildLocalStorage",
        registrationKey: "localStorage",
        modulePath: "buildLocalStorage.ts",
        relImport: "../factories/buildLocalStorage.js",
        contractName: "Storage",
        implementationName: "localStorage",
        lifetime: "singleton",
        moduleIndex: 0,
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
        moduleIndex: 1,
        discoveredBy: "naming",
      },
    },
  },
  // loggers
  loggers: {
    kind: "collection",
    baseType: "LoggingService",
    baseTypeId:
      "/home/reharik/Development/ioc-manifest/examples/multi-package/packages/lib-contracts/src/types/LoggingService.ts:LoggingService",
    members: [
      {
        contractName: "LoggingService",
        registrationKey: "storageEventLogger",
      },
    ],
  },

  // storages
  storages: {
    kind: "collection",
    baseType: "Storage",
    baseTypeId:
      "/home/reharik/Development/ioc-manifest/examples/multi-package/packages/lib-storage/src/types/Storage.ts:Storage",
    members: [
      {
        contractName: "Storage",
        registrationKey: "localStorage",
      },
      {
        contractName: "Storage",
        registrationKey: "s3Storage",
      },
    ],
  },
} as const satisfies IocGeneratedContainerManifest<IocManifestGroupRoots>;

export const IOC_SCOPE_PROVIDED_KEYS = [] as const;
