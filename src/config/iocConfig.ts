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
 * Per-implementation overrides in `ioc.config` only (never read from factory modules).
 * `name` sets the Awilix registration key (maps to internal `registrationKey`).
 */
export type IocOverride = {
  /** Awilix/container registration key; applied as `registrationKey` during planning. */
  name?: string;
  lifetime?: IocLifetime;
  default?: boolean;
  /**
   * App mode only. Resolves same registration-key conflicts across composed manifests:
   * `'local'` or a package name from `composedManifests`.
   */
  source?: "local" | string;
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

/**
 * One discovery root. Emitted manifest imports are relative paths from `generatedDir`.
 */
export type IocScanDirSpec = {
  path: string;
  /**
   * Default Awilix registration lifetime for factories discovered under this root (unless overridden
   * by `registrations[Contract][implementation]`).
   */
  scope?: IocLifetime;
};

/**
 * - `string`: single directory (relative to package root unless absolute)
 * - `string[]`: multiple directories
 * - `IocScanDirSpec[]`: directories with optional per-root `scope`
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
  };
  /**
   * Package names whose manifests this app composes. Non-empty triggers app-mode codegen
   * (`ioc-composed.ts`). Omit for library mode.
   */
  composedManifests?: string[];
  /**
   * Library mode only. Informational path for `package.json` exports (default `./generated/ioc-manifest`).
   */
  manifestExportPath?: string;
  /**
   * Fallback local package name when `package.json` has no `name` (self-reference detection in app mode).
   */
  packageName?: string;
  registrations?: Record<string, IocRegistrationsPerContract>;
  /**
   * Group registrations by assignability to a named `baseType` (interface or type alias in the program).
   * See {@link IocGroupsConfig}.
   */
  groups?: IocGroupsConfig;
  /**
   * App mode only. Declares equivalence sets of canonical base-type identifiers for a group name
   * when diamond-dependency hoisting produces mismatched ids (§14.4.1).
   */
  groupBaseTypeAliases?: Record<string, string[]>;
  /**
   * Maps interface or type-alias names to lifetimes. A factory whose return type is assignable to
   * a marker name inherits that marker's lifetime (see lifetime precedence in docs).
   */
  lifetimeMarkers?: Record<string, IocLifetime>;
};

export const defineIocConfig = (config: IocConfig): IocConfig => config;
