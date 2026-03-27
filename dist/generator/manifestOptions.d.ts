import type { IocConfig } from "../config/iocConfig.js";
import type { ManifestRuntimePaths } from "./manifestPaths.js";
export type ManifestOptions = {
    paths: ManifestRuntimePaths;
    includePatterns: string[];
    excludePatterns: string[];
    factoryExportPrefix: string;
};
export declare const DEFAULT_MANIFEST_OPTIONS: ManifestOptions;
export declare const resolveManifestOptions: (overrides?: Partial<Omit<ManifestOptions, "paths">> & {
    paths?: Partial<ManifestRuntimePaths>;
}) => ManifestOptions;
export declare const mergeManifestOptionsWithIocConfig: (base: ManifestOptions, config: IocConfig) => ManifestOptions;
//# sourceMappingURL=manifestOptions.d.ts.map