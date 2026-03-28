import * as ioc_examples_a_single_implementation from "../examples/a-single-implementation.js";
import * as ioc_examples_b_multiple_implementations from "../examples/b-multiple-implementations.js";
import * as ioc_examples_c_default_selection from "../examples/c-default-selection.js";
import * as ioc_examples_d_grouping from "../examples/d-grouping.js";
import * as ioc_examples_f_dependency_injection from "../examples/f-dependency-injection.js";
export declare const iocManifest: {
    readonly moduleImports: readonly [typeof ioc_examples_a_single_implementation, typeof ioc_examples_b_multiple_implementations, typeof ioc_examples_c_default_selection, typeof ioc_examples_d_grouping, typeof ioc_examples_f_dependency_injection];
    readonly contracts: {
        readonly AlbumService: {
            readonly albumService: {
                readonly exportName: "buildAlbumService";
                readonly registrationKey: "albumService";
                readonly sourceFile: "examples/f-dependency-injection.ts";
                readonly lifetime: "singleton";
                readonly default: true;
                readonly discoveredBy: "naming";
                readonly dependencyContractNames: readonly ["MediaStorage"];
            };
        };
        readonly CacheClient: {
            readonly memoryCache: {
                readonly exportName: "buildMemoryCache";
                readonly registrationKey: "memoryCache";
                readonly sourceFile: "examples/d-grouping.ts";
                readonly lifetime: "singleton";
                readonly default: true;
                readonly discoveredBy: "naming";
            };
        };
        readonly Logger: {
            readonly consoleLogger: {
                readonly exportName: "buildConsoleLogger";
                readonly registrationKey: "consoleLogger";
                readonly sourceFile: "examples/a-single-implementation.ts";
                readonly lifetime: "singleton";
                readonly default: true;
                readonly discoveredBy: "naming";
                readonly configOverridesApplied: readonly ["default"];
            };
        };
        readonly MediaStorage: {
            readonly localMediaStorage: {
                readonly exportName: "buildLocalMediaStorage";
                readonly registrationKey: "localMediaStorage";
                readonly sourceFile: "examples/b-multiple-implementations.ts";
                readonly lifetime: "singleton";
                readonly discoveredBy: "naming";
            };
            readonly mediaStorage: {
                readonly exportName: "buildMediaStorage";
                readonly registrationKey: "mediaStorage";
                readonly sourceFile: "examples/c-default-selection.ts";
                readonly lifetime: "singleton";
                readonly discoveredBy: "naming";
            };
            readonly s3MediaStorage: {
                readonly exportName: "buildS3MediaStorage";
                readonly registrationKey: "s3MediaStorage";
                readonly sourceFile: "examples/b-multiple-implementations.ts";
                readonly lifetime: "singleton";
                readonly default: true;
                readonly discoveredBy: "naming";
                readonly configOverridesApplied: readonly ["default"];
            };
        };
        readonly Widget: {
            readonly primaryWidget: {
                readonly exportName: "buildPrimaryWidget";
                readonly registrationKey: "primaryWidget";
                readonly sourceFile: "examples/c-default-selection.ts";
                readonly lifetime: "singleton";
                readonly default: true;
                readonly discoveredBy: "naming";
                readonly configOverridesApplied: readonly ["default"];
            };
            readonly secondaryWidget: {
                readonly exportName: "buildSecondaryWidget";
                readonly registrationKey: "secondaryWidget";
                readonly sourceFile: "examples/c-default-selection.ts";
                readonly lifetime: "singleton";
                readonly discoveredBy: "naming";
            };
        };
    };
    readonly bundles: {
        readonly services: {
            readonly album: [{
                readonly contractName: "AlbumService";
                readonly registrationKey: "albumService";
            }];
            readonly media: {
                readonly read: [{
                    readonly contractName: "MediaStorage";
                    readonly registrationKey: "mediaStorage";
                }];
            };
            readonly read: [{
                readonly contractName: "AlbumService";
                readonly registrationKey: "albumService";
            }, {
                readonly contractName: "MediaStorage";
                readonly registrationKey: "mediaStorage";
            }];
        };
    };
};
//# sourceMappingURL=ioc-manifest.d.ts.map