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
import * as ioc_examples_g_class_registration from "../examples/g-class-registration.js";
import * as ioc_examples_h_scope_root from "../examples/h-scope-root.js";

type IocManifestGroupRoots = {
  readonly mediaStoragesGroup: {
    readonly kind: "collection";
    readonly baseType: "MediaStorage";
    readonly baseTypeId: "ioc-manifest/src/examples/b-multiple-implementations.ts:MediaStorage";
    readonly members: readonly [
      {
        readonly contractName: "MediaStorage";
        readonly registrationKey: "archiveMediaStorage";
      },
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
};

export const iocManifest = {
  manifestSchemaVersion: 3,

  moduleImports: [
    ioc_examples_a_single_implementation,
    ioc_examples_b_multiple_implementations,
    ioc_examples_c_default_selection,
    ioc_examples_d_grouping,
    ioc_examples_f_dependency_injection,
    ioc_examples_g_class_registration,
    ioc_examples_h_scope_root,
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
        dependencyKeys: ["mediaStorage"],
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
      archiveMediaStorage: {
        kind: "class",
        exportName: "ArchiveMediaStorage",
        registrationKey: "archiveMediaStorage",
        modulePath: "examples/g-class-registration.ts",
        relImport: "../examples/g-class-registration.js",
        contractName: "MediaStorage",
        implementationName: "archiveMediaStorage",
        lifetime: "singleton",
        moduleIndex: 5,
        discoveredBy: "implements",
        dependencyContractNames: ["MediaStorage"],
        dependencyKeys: ["mediaStorage"],
      },
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
    ReportGateway: {
      reportGateway: {
        exportName: "buildReportGateway",
        registrationKey: "reportGateway",
        modulePath: "examples/h-scope-root.ts",
        relImport: "../examples/h-scope-root.js",
        contractName: "ReportGateway",
        implementationName: "reportGateway",
        lifetime: "singleton",
        moduleIndex: 6,
        default: true,
        discoveredBy: "naming",
        dependencyKeys: ["openRequestReportScope"],
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
  scopeRoots: {
    RequestReport: {
      publicReport: {
        exportName: "buildPublicReport",
        openerKey: "openPublicReportScope",
        variantKey: "publicReport",
        contractName: "RequestReport",
        variantName: "publicReport",
        modulePath: "examples/h-scope-root.ts",
        relImport: "../examples/h-scope-root.js",
        lbvKeys: [],
        moduleIndex: 6,
      },
      requestReport: {
        exportName: "buildRequestReport",
        openerKey: "openRequestReportScope",
        variantKey: "requestReport",
        contractName: "RequestReport",
        variantName: "requestReport",
        modulePath: "examples/h-scope-root.ts",
        relImport: "../examples/h-scope-root.js",
        lbvKeys: ["viewer"],
        moduleIndex: 6,
      },
    },
  },
  // mediaStoragesGroup
  mediaStoragesGroup: {
    kind: "collection",
    baseType: "MediaStorage",
    baseTypeId:
      "ioc-manifest/src/examples/b-multiple-implementations.ts:MediaStorage",
    members: [
      {
        contractName: "MediaStorage",
        registrationKey: "archiveMediaStorage",
      },
      {
        contractName: "MediaStorage",
        registrationKey: "localMediaStorage",
      },
      {
        contractName: "MediaStorage",
        registrationKey: "s3MediaStorage",
      },
    ],
  },
} as const satisfies IocGeneratedContainerManifest<IocManifestGroupRoots>;

export const IOC_SCOPE_PROVIDED_KEYS = [] as const;

/* Optional manifest data this file is known to carry in full. A composing app reads it to tell
   "this unit has no dependency keys" apart from "this manifest predates dependency keys". */
export const IOC_MANIFEST_FEATURES = ["dependencyKeys"] as const;
