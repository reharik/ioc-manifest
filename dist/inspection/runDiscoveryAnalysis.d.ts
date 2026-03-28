import type { DiscoveredFactory } from "../generator/types.js";
import type { ManifestRuntimePaths } from "../generator/manifestPaths.js";
import type { IocDiscoveryAnalysisFiles } from "../generator/discoverFactories/discoveryOutcomeTypes.js";
export type DiscoveryAnalysisResult = {
    readonly discoveryFiles: IocDiscoveryAnalysisFiles;
    readonly contractMap: Map<string, Map<string, DiscoveredFactory>>;
    readonly acceptedFactories: readonly DiscoveredFactory[];
};
/**
 * Re-runs factory discovery from source (and TypeScript) for inspection / CLI.
 * Does not read or write the generated manifest.
 */
export declare const runDiscoveryAnalysis: (opts?: {
    iocConfigPath?: string;
    paths?: Partial<ManifestRuntimePaths>;
}) => Promise<DiscoveryAnalysisResult>;
//# sourceMappingURL=runDiscoveryAnalysis.d.ts.map