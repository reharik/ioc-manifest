import ts from "typescript";
import type { IocConfig } from "../../config/iocConfig.js";
import type { DiscoveredFactory } from "../types.js";
import type { FactoryDiscoveryPaths } from "../manifestPaths.js";
export declare const discoverFactories: (files: string[], program: ts.Program, projectRoot: string, factoryPrefix: string, discoveryPaths: FactoryDiscoveryPaths, iocConfig?: IocConfig) => {
    contractMap: Map<string, Map<string, DiscoveredFactory>>;
    acceptedFactories: DiscoveredFactory[];
};
//# sourceMappingURL=discoverFactories.d.ts.map