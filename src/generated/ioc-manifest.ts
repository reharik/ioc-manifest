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
  readonly notificationChannels: {
    readonly kind: "object";
    readonly baseType: "NotificationChannel";
    readonly baseTypeId: "ioc-manifest/src/examples/d-grouping.ts:NotificationChannel";
    readonly members: {
      readonly emailChannel: {
        readonly contractName: "EmailChannel";
        readonly registrationKey: "emailChannel";
      };
      readonly smsChannel: {
        readonly contractName: "SmsChannel";
        readonly registrationKey: "smsChannel";
      };
    };
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
        lifetimeSource: "default",
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
        lifetimeSource: "default",
      },
    },
    DispatchService: {
      dispatchService: {
        exportName: "buildDispatchService",
        registrationKey: "dispatchService",
        modulePath: "examples/d-grouping.ts",
        relImport: "../examples/d-grouping.js",
        contractName: "DispatchService",
        implementationName: "dispatchService",
        lifetime: "singleton",
        moduleIndex: 3,
        default: true,
        discoveredBy: "naming",
        dependencyKeys: ["notificationChannels"],
        lifetimeSource: "default",
      },
    },
    EmailChannel: {
      emailChannel: {
        exportName: "buildEmailChannel",
        registrationKey: "emailChannel",
        modulePath: "examples/d-grouping.ts",
        relImport: "../examples/d-grouping.js",
        contractName: "EmailChannel",
        implementationName: "emailChannel",
        lifetime: "singleton",
        moduleIndex: 3,
        discoveredBy: "naming",
        lifetimeSource: "default",
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
        lifetimeSource: "default",
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
        lifetimeSource: "default",
      },
      auditedMediaStorage: {
        exportName: "buildAuditedMediaStorage",
        registrationKey: "auditedMediaStorage",
        modulePath: "examples/c-default-selection.ts",
        relImport: "../examples/c-default-selection.js",
        contractName: "MediaStorage",
        implementationName: "auditedMediaStorage",
        lifetime: "singleton",
        moduleIndex: 2,
        discoveredBy: "naming",
        lifetimeSource: "default",
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
        lifetimeSource: "default",
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
        lifetimeSource: "default",
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
        lifetimeSource: "default",
      },
    },
    SmsChannel: {
      smsChannel: {
        exportName: "buildSmsChannel",
        registrationKey: "smsChannel",
        modulePath: "examples/d-grouping.ts",
        relImport: "../examples/d-grouping.js",
        contractName: "SmsChannel",
        implementationName: "smsChannel",
        lifetime: "singleton",
        moduleIndex: 3,
        discoveredBy: "naming",
        lifetimeSource: "default",
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
        lifetimeSource: "default",
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
        lifetimeSource: "default",
      },
    },
    WidgetInspector: {
      widgetInspector: {
        exportName: "buildWidgetInspector",
        registrationKey: "widgetInspector",
        modulePath: "examples/c-default-selection.ts",
        relImport: "../examples/c-default-selection.js",
        contractName: "WidgetInspector",
        implementationName: "widgetInspector",
        lifetime: "singleton",
        moduleIndex: 2,
        default: true,
        discoveredBy: "naming",
        dependencyContractNames: ["Widget"],
        dependencyKeys: ["widget", "secondaryWidget"],
        lifetimeSource: "default",
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
  // notificationChannels
  notificationChannels: {
    kind: "object",
    baseType: "NotificationChannel",
    baseTypeId: "ioc-manifest/src/examples/d-grouping.ts:NotificationChannel",
    members: {
      emailChannel: {
        contractName: "EmailChannel",
        registrationKey: "emailChannel",
      },
      smsChannel: {
        contractName: "SmsChannel",
        registrationKey: "smsChannel",
      },
    },
  },
} as const satisfies IocGeneratedContainerManifest<IocManifestGroupRoots>;

export const IOC_SCOPE_PROVIDED_KEYS = [] as const;

/* Optional manifest data this file is known to carry in full. A composing app reads it to tell
   "this unit records none of this" apart from "this manifest predates the field". */
export const IOC_MANIFEST_FEATURES = [
  "dependencyKeys",
  "lifetimeSource",
] as const;
