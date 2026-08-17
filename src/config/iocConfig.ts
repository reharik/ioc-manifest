import type { IocGroupsConfig } from "../groups/resolveGroupPlan.js";
import {
  contractMetadataSchema,
  formatContractMetadataIssues,
  IOC_CONTRACT_CONFIG_KEY,
} from "./iocConfigSchema.js";

export { IOC_CONTRACT_CONFIG_KEY } from "./iocConfigSchema.js";

export type IocLifetime = "singleton" | "scoped" | "transient";

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
  /**
   * Suppresses the codegen warning emitted when this contract has a single implementation whose
   * registration key diverges from the contract access key (two cradle names for one thing).
   * Set `true` to declare the divergence intentional.
   */
  allowDivergentName?: boolean;
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
  /** Knowingly allow this implementation to depend on shorter-lived deps.
      `true` suppresses all inversions for this consumer; a string[] suppresses
      only those demanded keys (preferred — keeps other inversions visible). */
  allowLifetimeInversion?: boolean | readonly string[];
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
  const parsed = contractMetadataSchema.safeParse(entry);
  if (!parsed.success) {
    throw new Error(formatContractMetadataIssues(parsed.error, pathForError));
  }

  const out: IocContractMetadata = {};
  if (parsed.data.accessKey !== undefined) {
    out.accessKey = parsed.data.accessKey;
  }
  if (parsed.data.allowDivergentName !== undefined) {
    out.allowDivergentName = parsed.data.allowDivergentName;
  }
  return out;
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
  if ("allowLifetimeInversion" in value) {
    return true;
  }
  if ("accessKey" in value || "allowDivergentName" in value) {
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
  /**
   * Dependency keys supplied at runtime by registration onto a request child scope
   * (e.g. `scope.register({ viewerId: asValue(...) })`), not built by any factory.
   * Such keys are demanded by factories but must NOT be required to be supplied by a
   * composed manifest — they are excluded from the externals-satisfaction check.
   */
  scopeProvided?: string[];
};

export const defineIocConfig = (config: IocConfig): IocConfig => config;
