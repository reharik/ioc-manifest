/* AUTO-GENERATED. DO NOT EDIT.
Primary container manifest.
Re-run `npm run gen:manifest` after changing factories or IoC config.
*/
import type {
  IocGeneratedContainerManifest,
  IocModuleNamespace,
} from "ioc-manifest";

import * as ioc_examples_a_single_implementation from "../examples/a-single-implementation.js";
import * as ioc_examples_b_multiple_implementations from "../examples/b-multiple-implementations.js";
import * as ioc_examples_c_default_selection from "../examples/c-default-selection.js";
import * as ioc_examples_d_grouping from "../examples/d-grouping.js";
import * as ioc_examples_f_dependency_injection from "../examples/f-dependency-injection.js";

type IocManifestGroupRoots = {
  readonly mediaStoragesGroup: readonly [
    {
      readonly contractName: "MediaStorage";
      readonly registrationKey: "localMediaStorage";
    },
    {
      readonly contractName: "MediaStorage";
      readonly registrationKey: "s3MediaStorage";
    },
  ];
};

export const iocManifest = {
  moduleImports: [
    ioc_examples_a_single_implementation,
    ioc_examples_b_multiple_implementations,
    ioc_examples_c_default_selection,
    ioc_examples_d_grouping,
    ioc_examples_f_dependency_injection,
  ] as const satisfies readonly IocModuleNamespace[],

  contracts: {
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
        discoveredBy: "naming",
        dependencyContractNames: ["MediaStorage"],
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
        discoveredBy: "naming",
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
        discoveredBy: "naming",
        configOverridesApplied: ["default"],
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
        discoveredBy: "naming",
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
        discoveredBy: "naming",
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
        discoveredBy: "naming",
        configOverridesApplied: ["default"],
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
        discoveredBy: "naming",
        configOverridesApplied: ["default"],
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
        discoveredBy: "naming",
      },
    },
  },
  // mediaStoragesGroup
  mediaStoragesGroup: [
    {
      contractName: "MediaStorage",
      registrationKey: "localMediaStorage",
    },
    {
      contractName: "MediaStorage",
      registrationKey: "s3MediaStorage",
    },
  ],
} as const satisfies IocGeneratedContainerManifest<IocManifestGroupRoots>;
