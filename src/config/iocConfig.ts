import type { IocGroupsConfig } from "../groups/resolveGroupPlan.js";

export type IocLifetime = "singleton" | "scoped" | "transient";

/** Reserved key under `registrations[ContractName]` for contract-level metadata (not an implementation). */
export const IOC_CONTRACT_CONFIG_KEY = "$contract" as const;

/**
 * Contract-level options under `registrations[ContractName][IOC_CONTRACT_CONFIG_KEY]`.
 * Separate from per-implementation {@link IocOverride} entries.
 */
export type IocContractMetadata = {
  /**
   * Cradle / default-slot key for this contract (singular exposure). When omitted, derived from the
   * contract name (e.g. `Knex` → `knex`).
   */
  accessKey?: string;
};

/**
 * Per-implementation overrides keyed by contract name, then discovered implementation name.
 * `name` sets the Awilix registration key (maps to internal `registrationKey`).
 * Other fields align with {@link DiscoveredFactory} so new override keys can match the planning model.
 */
export type IocOverride = {
  /** Awilix/container registration key; applied as `registrationKey` during planning. */
  name?: string;
  lifetime?: IocLifetime;
  default?: boolean;
};

export type IocRegistrationsPerContract = Record<
  string,
  IocOverride | IocContractMetadata
>;

export const parseContractLevelConfig = (
  entry: unknown,
  pathForError: string,
): IocContractMetadata => {
  if (entry === undefined) {
    return {};
  }
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new Error(`[ioc-config] ${pathForError} must be an object`);
  }
  const rec = entry as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    if (k !== "accessKey") {
      throw new Error(
        `[ioc-config] ${pathForError} has unknown property ${JSON.stringify(k)} (only accessKey is allowed)`,
      );
    }
  }
  const accessKey = rec.accessKey;
  if (accessKey === undefined) {
    return {};
  }
  if (typeof accessKey !== "string" || accessKey.length === 0) {
    throw new Error(
      `[ioc-config] ${pathForError}.accessKey must be a non-empty string when set`,
    );
  }
  if (accessKey === IOC_CONTRACT_CONFIG_KEY) {
    throw new Error(
      `[ioc-config] ${pathForError}.accessKey cannot be ${JSON.stringify(IOC_CONTRACT_CONFIG_KEY)} (reserved)`,
    );
  }
  return { accessKey };
};

export const getContractLevelConfig = (
  perContract: IocRegistrationsPerContract | undefined,
  contractLabel: string,
): IocContractMetadata => {
  if (perContract === undefined) {
    return {};
  }
  const raw = perContract[IOC_CONTRACT_CONFIG_KEY];
  if (raw === undefined) {
    return {};
  }
  return parseContractLevelConfig(
    raw,
    `registrations[${JSON.stringify(contractLabel)}][${JSON.stringify(IOC_CONTRACT_CONFIG_KEY)}]`,
  );
};

/** True when the value is per-implementation config (not a misplaced `$contract` object). */
export const isIocImplementationOverride = (
  value: IocOverride | IocContractMetadata,
): value is IocOverride => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if ("name" in value || "lifetime" in value || "default" in value) {
    return true;
  }
  if ("accessKey" in value) {
    return false;
  }
  return true;
};

export const getImplOverrideForImplementation = (
  perContract: IocRegistrationsPerContract | undefined,
  implementationName: string,
): IocOverride | undefined => {
  if (perContract === undefined) {
    return undefined;
  }
  if (implementationName === IOC_CONTRACT_CONFIG_KEY) {
    return undefined;
  }
  const raw = perContract[implementationName];
  if (raw === undefined || !isIocImplementationOverride(raw)) {
    return undefined;
  }
  return raw;
};

/** How manifest import specifiers are built when {@link IocScanDirSpec.importPrefix} is set. */
export type IocScanDirImportMode = "root" | "subpath";

/**
 * Maps a workspace source root to the public import specifier used in generated type-only imports
 * (e.g. `{ root: "packages/lib/src", importBase: "@acme/lib" }`).
 */
export type IocWorkspacePackageImportBase = {
  /** Directory root (relative to the project root unless absolute). */
  root: string;
  /** Bare module specifier for imports (no file extensions). */
  importBase: string;
};

/**
 * One discovery root with optional workspace/package import mapping.
 * `importPrefix` + `importMode` control emitted `import` specifiers; omit both for normal relative imports from the generated dir.
 */
export type IocScanDirSpec = {
  path: string;
  /** Package or path alias (e.g. `@packages/my-package`). Requires `importMode` when set. */
  importPrefix?: string;
  /** Required when `importPrefix` is set. */
  importMode?: IocScanDirImportMode;
};

/**
 * - `string`: single directory (relative to package root unless absolute)
 * - `string[]`: multiple directories
 * - `IocScanDirSpec[]`: directories with optional `importPrefix` / `importMode` for manifest imports
 */
export type IocDiscoveryScanDirs = string | string[] | IocScanDirSpec[];

export type IocConfig = {
  discovery: {
    scanDirs: IocDiscoveryScanDirs;
    includes?: string[];
    excludes?: string[];
    factoryPrefix?: string;
    /** Output directory relative to the package root unless absolute. Default: `"generated"`. */
    generatedDir?: string;
    /**
     * When a contract type resolves to a file under `root`, emit `importBase` instead of a long
     * relative path. Longest matching `root` wins. Checked before `scanDirs` importPrefix/subpath
     * mapping so public entrypoints can win over deep subpath emission.
     */
    workspacePackageImportBases?: IocWorkspacePackageImportBase[];
  };
  registrations?: Record<string, IocRegistrationsPerContract>;
  /**
   * Group registrations by assignability to a named `baseType` (interface or type alias in the program).
   * See {@link IocGroupsConfig}.
   */
  groups?: IocGroupsConfig;
};

export const defineIocConfig = (config: IocConfig): IocConfig => config;
