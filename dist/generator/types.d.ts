import ts from "typescript";
import type { IocConfig, IocLifetime } from "../config/iocConfig.js";
import type { FactoryDiscoveryPaths } from "./manifestPaths.js";
/**
 * One injectable factory discovered in a source file.
 * `contractTypeRelImport` is the module that declares the contract type symbol
 * (from the TypeScript checker), used for generated type-only imports — independent of default selection.
 */
export type DiscoveredFactory = {
    contractName: string;
    /** Relative import from the generated manifest dir to the contract type's declaration module. */
    contractTypeRelImport: string;
    implementationName: string;
    exportName: string;
    registrationKey: string;
    modulePath: string;
    relImport: string;
    default?: boolean;
    lifetime?: IocLifetime;
};
export type FactoryDiscoveryFileContext = {
    absPath: string;
    sourceFile: ts.SourceFile;
    projectRoot: string;
    factoryPrefix: string;
    paths: FactoryDiscoveryPaths;
    /** When set, `registrations[contract][implementation].name` participates in registration key resolution. */
    iocConfig?: IocConfig;
};
//# sourceMappingURL=types.d.ts.map