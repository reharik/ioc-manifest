/* AUTO-GENERATED. DO NOT EDIT.
Primary container manifest.
Re-run `npm run gen:manifest` after changing factories or IoC config.
*/
import type {
  IocGeneratedContainerManifest,
  IocModuleNamespace,
} from "ioc-manifest";

import * as ioc_buildConfig from "../factories/buildConfig.js";
import * as ioc_buildConsoleLogger from "../factories/buildConsoleLogger.js";

export const iocManifest = {
  manifestSchemaVersion: 2,

  moduleImports: [
    ioc_buildConfig,
    ioc_buildConsoleLogger,
  ] as const satisfies readonly IocModuleNamespace[],

  contracts: {
    AppConfig: {
      config: {
        exportName: "buildConfig",
        registrationKey: "config",
        modulePath: "buildConfig.ts",
        relImport: "../factories/buildConfig.js",
        contractName: "AppConfig",
        implementationName: "config",
        lifetime: "singleton",
        moduleIndex: 0,
        default: true,
        discoveredBy: "naming",
      },
    },
    Logger: {
      consoleLogger: {
        exportName: "buildConsoleLogger",
        registrationKey: "consoleLogger",
        modulePath: "buildConsoleLogger.ts",
        relImport: "../factories/buildConsoleLogger.js",
        contractName: "Logger",
        implementationName: "consoleLogger",
        lifetime: "singleton",
        moduleIndex: 1,
        default: true,
        discoveredBy: "naming",
        configOverridesApplied: ["default"],
      },
    },
  },
} as const satisfies IocGeneratedContainerManifest;

export const IOC_SCOPE_PROVIDED_KEYS = [] as const;
