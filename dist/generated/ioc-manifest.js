import * as ioc_examples_a_single_implementation from "../examples/a-single-implementation.js";
import * as ioc_examples_b_multiple_implementations from "../examples/b-multiple-implementations.js";
import * as ioc_examples_c_default_selection from "../examples/c-default-selection.js";
import * as ioc_examples_d_grouping from "../examples/d-grouping.js";
import * as ioc_examples_f_dependency_injection from "../examples/f-dependency-injection.js";
export const iocManifest = {
    moduleImports: [
        ioc_examples_a_single_implementation,
        ioc_examples_b_multiple_implementations,
        ioc_examples_c_default_selection,
        ioc_examples_d_grouping,
        ioc_examples_f_dependency_injection,
    ],
    contracts: {
        // AlbumService
        AlbumService: {
            albumService: {
                exportName: "buildAlbumService",
                registrationKey: "albumService",
                sourceFile: "examples/f-dependency-injection.ts",
                lifetime: "singleton",
                default: true,
                discoveredBy: "naming",
                dependencyContractNames: ["MediaStorage"],
            },
        },
        // CacheClient
        CacheClient: {
            memoryCache: {
                exportName: "buildMemoryCache",
                registrationKey: "memoryCache",
                sourceFile: "examples/d-grouping.ts",
                lifetime: "singleton",
                default: true,
                discoveredBy: "naming",
            },
        },
        // Logger
        Logger: {
            consoleLogger: {
                exportName: "buildConsoleLogger",
                registrationKey: "consoleLogger",
                sourceFile: "examples/a-single-implementation.ts",
                lifetime: "singleton",
                default: true,
                discoveredBy: "naming",
                configOverridesApplied: ["default"],
            },
        },
        // MediaStorage
        MediaStorage: {
            localMediaStorage: {
                exportName: "buildLocalMediaStorage",
                registrationKey: "localMediaStorage",
                sourceFile: "examples/b-multiple-implementations.ts",
                lifetime: "singleton",
                discoveredBy: "naming",
            },
            mediaStorage: {
                exportName: "buildMediaStorage",
                registrationKey: "mediaStorage",
                sourceFile: "examples/c-default-selection.ts",
                lifetime: "singleton",
                discoveredBy: "naming",
            },
            s3MediaStorage: {
                exportName: "buildS3MediaStorage",
                registrationKey: "s3MediaStorage",
                sourceFile: "examples/b-multiple-implementations.ts",
                lifetime: "singleton",
                default: true,
                discoveredBy: "naming",
                configOverridesApplied: ["default"],
            },
        },
        // Widget
        Widget: {
            primaryWidget: {
                exportName: "buildPrimaryWidget",
                registrationKey: "primaryWidget",
                sourceFile: "examples/c-default-selection.ts",
                lifetime: "singleton",
                default: true,
                discoveredBy: "naming",
                configOverridesApplied: ["default"],
            },
            secondaryWidget: {
                exportName: "buildSecondaryWidget",
                registrationKey: "secondaryWidget",
                sourceFile: "examples/c-default-selection.ts",
                lifetime: "singleton",
                discoveredBy: "naming",
            },
        },
    },
    bundles: {
        services: {
            album: [
                {
                    contractName: "AlbumService",
                    registrationKey: "albumService",
                },
            ],
            media: {
                read: [
                    {
                        contractName: "MediaStorage",
                        registrationKey: "mediaStorage",
                    },
                ],
            },
            read: [
                {
                    contractName: "AlbumService",
                    registrationKey: "albumService",
                },
                {
                    contractName: "MediaStorage",
                    registrationKey: "mediaStorage",
                },
            ],
        },
    },
};
//# sourceMappingURL=ioc-manifest.js.map