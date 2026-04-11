import ts from "typescript";
import type { IocConfig, IocLifetime } from "../config/iocConfig.js";
import type { FactoryDiscoveryPaths } from "./manifestPaths.js";

/**
 * One discovered factory export in a source file.
 * `contractTypeRelImport` is the module that declares the contract type symbol
 * (from the TypeScript checker), used for generated type-only imports — independent of default selection.
 */
export type DiscoveredFactory = {
  contractName: string;
  /**
   * Module specifier for generated type-only imports: relative to the generated dir, a bare
   * package name (e.g. `knex`), or a workspace alias — not a path through `node_modules`.
   */
  contractTypeRelImport: string;
  implementationName: string;
  exportName: string;
  registrationKey: string;
  modulePath: string;
  relImport: string;
  default?: boolean;
  lifetime?: IocLifetime;
  /** Set when the export matched a discovery strategy. */
  discoveredBy?: "naming";
  /** Contract types inferred from the factory deps parameter (see manifest metadata). */
  dependencyContractNames?: string[];
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
