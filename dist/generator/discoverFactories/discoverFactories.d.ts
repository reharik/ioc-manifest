import ts from "typescript";
import type { IocConfig } from "../../config/iocConfig.js";
import type { DiscoveredFactory } from "../types.js";
import type { FactoryDiscoveryPaths } from "../manifestPaths.js";
import type { IocDiscoveryAnalysisFiles } from "./discoveryOutcomeTypes.js";
export type FactoryDiscoveryRunOptions = {
    /** When true, collect per-file outcomes for on-demand discovery reports (not written to manifest). */
    collectFileRecords?: boolean;
};
/**
 * Discovers factories and optionally collects full per-file scan records for analysis tooling.
 */
export declare const discoverFactories: (files: string[], program: ts.Program, projectRoot: string, factoryPrefix: string, discoveryPaths: FactoryDiscoveryPaths, iocConfig?: IocConfig, runOptions?: FactoryDiscoveryRunOptions) => {
    contractMap: Map<string, Map<string, DiscoveredFactory>>;
    acceptedFactories: DiscoveredFactory[];
    discoveryFiles: IocDiscoveryAnalysisFiles;
};
//# sourceMappingURL=discoverFactories.d.ts.map