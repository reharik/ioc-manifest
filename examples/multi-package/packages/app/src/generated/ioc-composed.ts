/* AUTO-GENERATED. DO NOT EDIT.
App-mode composition glue. Re-run `ioc generate` after changing factories, composed packages, or IoC config.
*/
import type { ComposedRegistrationOverrides } from "ioc-manifest";

import { iocManifest as localManifest } from "./ioc-manifest.js";
import { iocManifest as libStorageManifest } from "@example/lib-storage/iocManifest";
import { iocManifest as libServicesManifest } from "@example/lib-services/iocManifest";

import type { IocGeneratedCradle as LocalCradle } from "./ioc-registry.types.js";
import type { IocGeneratedCradle as LibStorageCradle } from "@example/lib-storage/iocTypes";
import type { IocGeneratedCradle as LibServicesCradle } from "@example/lib-services/iocTypes";
import type { IocExternals as LibStorageExternals } from "@example/lib-storage/iocTypes";
import type { IocExternals as LibServicesExternals } from "@example/lib-services/iocTypes";

export const composedManifests = [
  localManifest,
  libStorageManifest,
  libServicesManifest,
] as const;

export type AppCradle = LocalCradle & LibStorageCradle & LibServicesCradle;

// Compile-time externals satisfaction assertions
type _IocExpect<T extends true> = T;
// If any assertion below is `false`, run `ioc validate` for a detailed per-key explanation.
type _LibServicesExternalsPick = Pick<AppCradle, keyof LibServicesExternals>;
type _LibServices_config =
  _LibServicesExternalsPick["config"] extends LibServicesExternals["config"]
    ? true
    : false;
type _LibServices_configAssert = _IocExpect<_LibServices_config>;
type _LibServices_logger =
  _LibServicesExternalsPick["logger"] extends LibServicesExternals["logger"]
    ? true
    : false;
type _LibServices_loggerAssert = _IocExpect<_LibServices_logger>;
type _LibServices_storage =
  _LibServicesExternalsPick["storage"] extends LibServicesExternals["storage"]
    ? true
    : false;
type _LibServices_storageAssert = _IocExpect<_LibServices_storage>;

export const composedRegistrationOverrides = {
  composedPackageNames: ["@example/lib-storage", "@example/lib-services"],
  contracts: {
    Logger: {
      defaultImplementation: "consoleLogger",
    },
    LoggingService: {
      defaultImplementation: "requestTracingLogger",
    },
    Storage: {
      defaultImplementation: "s3Storage",
    },
  },
} as const satisfies ComposedRegistrationOverrides;
