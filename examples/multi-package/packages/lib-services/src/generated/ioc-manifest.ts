/* AUTO-GENERATED. DO NOT EDIT.
Primary container manifest.
Re-run `npm run gen:manifest` after changing factories or IoC config.
*/
import type {
  IocGeneratedContainerManifest,
  IocModuleNamespace,
} from "ioc-manifest";

import * as ioc_buildConfigProbe from "../factories/buildConfigProbe.js";
import * as ioc_buildRequestTracingLogger from "../factories/buildRequestTracingLogger.js";
import * as ioc_buildServiceLogger from "../factories/buildServiceLogger.js";
import * as ioc_buildUploadService from "../factories/buildUploadService.js";
import * as ioc_buildViewerReadService from "../factories/buildViewerReadService.js";

export const iocManifest = {
  manifestSchemaVersion: 3,

  moduleImports: [
    ioc_buildConfigProbe,
    ioc_buildRequestTracingLogger,
    ioc_buildServiceLogger,
    ioc_buildUploadService,
    ioc_buildViewerReadService,
  ] as const satisfies readonly IocModuleNamespace[],

  contracts: {
    ConfigProbe: {
      configProbe: {
        exportName: "buildConfigProbe",
        registrationKey: "configProbe",
        modulePath: "buildConfigProbe.ts",
        relImport: "../factories/buildConfigProbe.js",
        contractName: "ConfigProbe",
        implementationName: "configProbe",
        lifetime: "singleton",
        moduleIndex: 0,
        default: true,
        discoveredBy: "naming",
        dependencyKeys: ["config"],
      },
    },
    RequestTracingLogger: {
      requestTracingLogger: {
        exportName: "buildRequestTracingLogger",
        registrationKey: "requestTracingLogger",
        modulePath: "buildRequestTracingLogger.ts",
        relImport: "../factories/buildRequestTracingLogger.js",
        contractName: "RequestTracingLogger",
        implementationName: "requestTracingLogger",
        lifetime: "scoped",
        moduleIndex: 1,
        default: true,
        discoveredBy: "naming",
      },
    },
    ServiceLogger: {
      serviceLogger: {
        exportName: "buildServiceLogger",
        registrationKey: "serviceLogger",
        modulePath: "buildServiceLogger.ts",
        relImport: "../factories/buildServiceLogger.js",
        contractName: "ServiceLogger",
        implementationName: "serviceLogger",
        lifetime: "singleton",
        moduleIndex: 2,
        default: true,
        discoveredBy: "naming",
        dependencyKeys: ["logger"],
      },
    },
    UploadService: {
      uploadService: {
        exportName: "buildUploadService",
        registrationKey: "uploadService",
        modulePath: "buildUploadService.ts",
        relImport: "../factories/buildUploadService.js",
        contractName: "UploadService",
        implementationName: "uploadService",
        lifetime: "singleton",
        moduleIndex: 3,
        default: true,
        discoveredBy: "naming",
        dependencyKeys: ["storage", "logger"],
      },
    },
    ViewerReadService: {
      viewerReadService: {
        exportName: "buildViewerReadService",
        registrationKey: "viewerReadService",
        modulePath: "buildViewerReadService.ts",
        relImport: "../factories/buildViewerReadService.js",
        contractName: "ViewerReadService",
        implementationName: "viewerReadService",
        lifetime: "scoped",
        moduleIndex: 4,
        default: true,
        discoveredBy: "naming",
        dependencyKeys: ["viewerId"],
      },
    },
  },
} as const satisfies IocGeneratedContainerManifest;

export const IOC_SCOPE_PROVIDED_KEYS = ["viewerId"] as const;

/* Optional manifest data this file is known to carry in full. A composing app reads it to tell
   "this unit has no dependency keys" apart from "this manifest predates dependency keys". */
export const IOC_MANIFEST_FEATURES = ["dependencyKeys"] as const;
