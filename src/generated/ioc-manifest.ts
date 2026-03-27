/* AUTO-GENERATED. DO NOT EDIT.
Re-run `npm run gen:manifest` after adding/removing injectable factories.
*/

import type { IocContractManifest } from "ioc-manifest";
import * as ioc_examples_a_single_implementation from "../examples/a-single-implementation.js";
import * as ioc_examples_b_multiple_implementations from "../examples/b-multiple-implementations.js";
import * as ioc_examples_c_default_selection from "../examples/c-default-selection.js";
import * as ioc_examples_d_grouping from "../examples/d-grouping.js";
import * as ioc_examples_f_dependency_injection from "../examples/f-dependency-injection.js";

export const iocModuleImports = [
  ioc_examples_a_single_implementation,
  ioc_examples_b_multiple_implementations,
  ioc_examples_c_default_selection,
  ioc_examples_d_grouping,
  ioc_examples_f_dependency_injection,
] as const;

export const iocManifestByContract: IocContractManifest = {
  AlbumService: {
    albumService: {
      exportName: "buildAlbumService",
      registrationKey: "albumService",
      modulePath: "examples/f-dependency-injection.ts",
      relImport: "../examples/f-dependency-injection.js",
      contractName: "AlbumService",
      implementationName: "albumService",
      lifetime: "singleton",
      moduleIndex: 4,
      default: true,
    },
  },
  CacheClient: {
    memoryCache: {
      exportName: "buildMemoryCache",
      registrationKey: "memoryCache",
      modulePath: "examples/d-grouping.ts",
      relImport: "../examples/d-grouping.js",
      contractName: "CacheClient",
      implementationName: "memoryCache",
      lifetime: "singleton",
      moduleIndex: 3,
      default: true,
    },
  },
  Logger: {
    consoleLogger: {
      exportName: "buildConsoleLogger",
      registrationKey: "consoleLogger",
      modulePath: "examples/a-single-implementation.ts",
      relImport: "../examples/a-single-implementation.js",
      contractName: "Logger",
      implementationName: "consoleLogger",
      lifetime: "singleton",
      moduleIndex: 0,
      default: true,
    },
  },
  MediaStorage: {
    localMediaStorage: {
      exportName: "buildLocalMediaStorage",
      registrationKey: "localMediaStorage",
      modulePath: "examples/b-multiple-implementations.ts",
      relImport: "../examples/b-multiple-implementations.js",
      contractName: "MediaStorage",
      implementationName: "localMediaStorage",
      lifetime: "singleton",
      moduleIndex: 1,
    },
    mediaStorage: {
      exportName: "buildMediaStorage",
      registrationKey: "mediaStorage",
      modulePath: "examples/c-default-selection.ts",
      relImport: "../examples/c-default-selection.js",
      contractName: "MediaStorage",
      implementationName: "mediaStorage",
      lifetime: "singleton",
      moduleIndex: 2,
    },
    s3MediaStorage: {
      exportName: "buildS3MediaStorage",
      registrationKey: "s3MediaStorage",
      modulePath: "examples/b-multiple-implementations.ts",
      relImport: "../examples/b-multiple-implementations.js",
      contractName: "MediaStorage",
      implementationName: "s3MediaStorage",
      lifetime: "singleton",
      moduleIndex: 1,
      default: true,
    },
  },
  Widget: {
    primaryWidget: {
      exportName: "buildPrimaryWidget",
      registrationKey: "primaryWidget",
      modulePath: "examples/c-default-selection.ts",
      relImport: "../examples/c-default-selection.js",
      contractName: "Widget",
      implementationName: "primaryWidget",
      lifetime: "singleton",
      moduleIndex: 2,
      default: true,
    },
    secondaryWidget: {
      exportName: "buildSecondaryWidget",
      registrationKey: "secondaryWidget",
      modulePath: "examples/c-default-selection.ts",
      relImport: "../examples/c-default-selection.js",
      contractName: "Widget",
      implementationName: "secondaryWidget",
      lifetime: "singleton",
      moduleIndex: 2,
    },
  },
};
export const iocBundlesManifest = undefined;
