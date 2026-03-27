export type IocModuleNamespace = Record<string, unknown>;

/** Manual / example wiring: list of modules with namespace exports (not codegen). */
export type IocManifestEntry = {
  modulePath: string;
  exports: IocModuleNamespace;
};

export type IocManifest = IocManifestEntry[];

/** Lifetime values stored in generated manifests (lowercase; maps to Awilix `Lifetime`). */
export type IocImplementationLifetime = "singleton" | "scoped" | "transient";

/**
 * Contract-first manifest: each contract (interface/type name) maps to one or more
 * module factories (inner keys are implementation names from discovery).
 */
export type ModuleFactoryManifestMetadata = {
  /** Exported factory identifier, e.g. `buildLocalMediaStorage`. */
  exportName: string;
  /** IoC registration key (from resolver metadata or derived module name). */
  registrationKey: string;
  /** Path relative to `src/`, informational. */
  modulePath: string;
  /** Relative import path from the generated manifest directory to the source file. */
  relImport: string;
  /** Contract / interface or type alias name the factory returns. */
  contractName: string;
  /** Derived from export: strip `build` prefix and lowercase first character (or resolver metadata). */
  implementationName: string;
  /** Awilix lifetime for this registration. */
  lifetime: IocImplementationLifetime;
  /** Index into the parallel `iocModuleImports` array. */
  moduleIndex: number;
  group?: string;
  /** True when this implementation is the resolved default for the contract (config + discovery). */
  default?: boolean;
};

export type IocContractManifest = Record<
  string,
  Record<string, ModuleFactoryManifestMetadata>
>;

export type IocBundleLeafManifest = {
  contractName: string;
  registrationKey: string;
};

export interface IocBundleObjectManifest {
  [key: string]: IocBundleNodeManifest;
}

export type IocBundleNodeManifest =
  | IocBundleLeafManifest[]
  | IocBundleObjectManifest;

export type IocBundlesManifest = Record<string, IocBundleNodeManifest>;
