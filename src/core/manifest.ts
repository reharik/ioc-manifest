export type IocModuleNamespace = Record<string, unknown>;

/** Lifetime values stored in generated manifests (lowercase; maps to Awilix `Lifetime`). */
export type IocImplementationLifetime = "singleton" | "scoped" | "transient";

export type IocConfigOverrideField =
  | "name"
  | "lifetime"
  | "default"
  | "accessKey";

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
  /** How the export was matched during discovery. */
  discoveredBy?: "naming";
  /** Which `ioc.config` registration fields were applied for this implementation after merge. */
  configOverridesApplied?: readonly IocConfigOverrideField[];
  /**
   * Contract types inferred as dependencies from the factory's first parameter (object properties).
   */
  dependencyContractNames?: readonly string[];
  /**
   * When set, Awilix default-slot / cradle key for this contract (singular). Omitted when equal to
   * the convention key (camel-cased contract name).
   */
  accessKey?: string;
};

export type IocContractManifest = Record<
  string,
  Record<string, ModuleFactoryManifestMetadata>
>;

/** Fixed top-level keys on the generated container manifest; group roots must not use these names. */
export const IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS: ReadonlySet<string> =
  new Set(["moduleImports", "contracts"]);

/**
 * Core shape every generated container manifest includes. Configured group roots are emitted
 * as additional top-level properties alongside these.
 */
export type IocGeneratedContainerManifestCore = {
  readonly moduleImports: readonly IocModuleNamespace[];
  readonly contracts: IocContractManifest;
};

/**
 * Primary generated container description: module imports, canonical contract manifest, and
 * configured group roots as top-level entries.
 *
 * `TGroupRoots` is intentionally loose (`Record<string, unknown>`): the emitted
 * `IocManifestGroupRoots` helper uses `readonly` tuple literals that are not always assignable to
 * `IocGroupsManifest`’s mutable `Record`/`array` types, while still matching the runtime shape.
 */
export type IocGeneratedContainerManifest<
  TGroupRoots extends Record<string, unknown> = Record<never, never>,
> = IocGeneratedContainerManifestCore & Readonly<TGroupRoots>;

/**
 * Full generated container manifest accepted by `registerIocFromManifest`: `moduleImports`,
 * `contracts`, and any extra top-level group-root entries emitted by codegen.
 */
export type IocRegisterableManifest = IocGeneratedContainerManifestCore &
  Record<string, unknown>;

/** One implementation slot in a generated group (collection item or object property value). */
export type IocGroupLeafManifest = {
  contractName: string;
  registrationKey: string;
};

/** Collection group: ordered list of implementations to resolve from the cradle. */
export type IocGroupCollectionManifest = IocGroupLeafManifest[];

/** Object group: property keys are contract keys (default implementation resolved per leaf `registrationKey`). */
export type IocGroupObjectManifest = Record<string, IocGroupLeafManifest>;

export type IocGroupNodeManifest =
  | IocGroupCollectionManifest
  | IocGroupObjectManifest;

export type IocGroupsManifest = Record<string, IocGroupNodeManifest>;
