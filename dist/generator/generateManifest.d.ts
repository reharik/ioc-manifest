import { ManifestOptions } from "./manifestOptions.js";
import type { ManifestRuntimePaths } from "./manifestPaths.js";
export declare const generateManifest: (overrides?: Partial<Omit<ManifestOptions, "paths">> & {
    paths?: Partial<ManifestRuntimePaths>;
    iocConfigPath?: string;
}) => Promise<void>;
//# sourceMappingURL=generateManifest.d.ts.map