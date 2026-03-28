export type IocModuleNamespace = Record<string, unknown>;
/** Manual / example wiring: list of modules with namespace exports (not codegen). */
export type IocManifestEntry = {
    modulePath: string;
    exports: IocModuleNamespace;
};
export type IocManifest = IocManifestEntry[];
/** Lifetime values stored in generated manifests (lowercase; maps to Awilix `Lifetime`). */
export type IocImplementationLifetime = "singleton" | "scoped" | "transient";
export type IocConfigOverrideField = "name" | "lifetime" | "default";
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
    /**
     * Same as `modulePath` (explicit alias for inspection tooling).
     * Omitted in older generated manifests; consumers should fall back to `modulePath`.
     */
    sourceFilePath?: string;
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
    /** How the export was matched during discovery. */
    discoveredBy?: "naming" | "injectable-wrapper";
    /** Which `ioc.config` registration fields were applied for this implementation after merge. */
    configOverridesApplied?: readonly IocConfigOverrideField[];
    /**
     * Contract types inferred as dependencies from the factory's first parameter (object properties).
     */
    dependencyContractNames?: readonly string[];
};
export type IocContractManifest = Record<string, Record<string, ModuleFactoryManifestMetadata>>;
/**
 * Human-oriented implementation row in the primary generated manifest (no moduleIndex/relImport).
 * Contract and implementation names come from the surrounding object keys.
 */
export type IocContainerImplementationView = {
    exportName: string;
    registrationKey: string;
    /** Source module path relative to `src/` (POSIX). */
    sourceFile: string;
    lifetime: IocImplementationLifetime;
    default?: boolean;
    discoveredBy?: "naming" | "injectable-wrapper";
    configOverridesApplied?: readonly IocConfigOverrideField[];
    dependencyContractNames?: readonly string[];
};
export type IocContainerContractsView = Record<string, Record<string, IocContainerImplementationView>>;
/**
 * Primary generated container description: one object for imports, contracts, and runtime bundles.
 */
export type IocGeneratedContainerManifest = {
    readonly moduleImports: readonly IocModuleNamespace[];
    readonly contracts: IocContainerContractsView;
    readonly bundles?: IocBundlesManifest;
};
export type IocBundleLeafManifest = {
    contractName: string;
    registrationKey: string;
};
export interface IocBundleObjectManifest {
    [key: string]: IocBundleNodeManifest;
}
export type IocBundleNodeManifest = IocBundleLeafManifest[] | IocBundleObjectManifest;
export type IocBundlesManifest = Record<string, IocBundleNodeManifest>;
/** Declared bundle entry as authored in config (contract name or nested bundle ref). */
export type IocBundleReferenceManifest = {
    $bundleRef: string;
};
export type IocBundleDeclaredMemberManifest = string | IocBundleReferenceManifest;
/**
 * Facts about one bundle array node: raw declared entries vs resolved contract registrations.
 */
export type IocBundleArrayInsight = {
    /** Dot-separated path of array bundle nodes, e.g. `services.read`. */
    bundlePath: string;
    declaredMembers: readonly IocBundleDeclaredMemberManifest[];
    expandedMembers: readonly IocBundleLeafManifest[];
};
export type IocBundleArraysInsightManifest = readonly IocBundleArrayInsight[];
//# sourceMappingURL=manifest.d.ts.map