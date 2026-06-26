/**
 * @fileoverview Turns discovered factories + `ioc.config` into a stable registration plan:
 * merge overrides, validate global Awilix key collisions and access/collection slots, resolve
 * default implementation per contract, attach lifetimes and metadata for codegen.
 */
import {
  getContractLevelConfig,
  getImplOverrideForImplementation,
  IOC_CONTRACT_CONFIG_KEY,
  type IocConfig,
  type IocLifetime,
  type IocOverride,
  type IocRegistrationsPerContract,
  isIocImplementationOverride,
} from "../config/iocConfig.js";
import type { IocConfigOverrideField } from "../core/manifest.js";
import type { ComposedManifestContractNames } from "./loadComposedManifestContracts.js";
import {
  resolveDiscoveryRootDefaultLifetime,
  resolveFactorySourceAbsPath,
  type ResolvedScanDir,
} from "./manifestPaths.js";
import { selectDefaultImplementationName } from "../core/defaultImplementationSelection.js";
import type { DiscoveredFactory } from "./types.js";
import { contractNameToDefaultRegistrationKey } from "./naming.js";

/** Where resolved registration lifetime came from (inspect/debug only). `discovery-root` = `discovery.scanDirs[].scope`. */
export type IocRegistrationLifetimeSource =
  | "factory-config"
  | "lifetime-marker"
  | "discovery-root"
  | "default";

export type RegistrationPlanLifetimeContext = {
  projectRoot: string;
  scanDirs: readonly ResolvedScanDir[];
  /** Contract names from composed package manifests (app mode). */
  composedContractNames?: ComposedManifestContractNames;
  /** Marker-resolved lifetimes keyed by `${modulePath}:${exportName}`. */
  markerLifetimesByFactoryKey?: ReadonlyMap<string, IocLifetime>;
};

export type ResolvedImplementationEntry = {
  /** Stable implementation id from discovery (factory export / resolver map key). */
  implementationName: string;
  /** Awilix/container registration name (respects resolver `key` / `name`). */
  registrationKey: string;
  exportName: string;
  modulePath: string;
  relImport: string;
  lifetime: IocLifetime;
  /** Present when {@link buildRegistrationPlan} received a lifetime context (e.g. codegen / inspect --discovery). */
  lifetimeSource?: IocRegistrationLifetimeSource;
  discoveredBy?: "naming";
  /** Fields present on the matching `ioc.config` registration override for this implementation. */
  configOverridesApplied?: readonly IocConfigOverrideField[];
  dependencyContractNames?: readonly string[];
};

export type ResolvedContractRegistration = {
  contractName: string;
  /**
   * Type-only import specifier for the contract symbol (from discovery; same for all implementations).
   * May be relative, bare (npm), or a workspace alias — independent of which implementation is default.
   */
  contractTypeRelImport: string;
  /**
   * Convention key: camel-cased contract name. Used for default-selection matching
   * (`registrationKey === contractKey`) and object-group keys — never overridden by `$contract.accessKey`.
   */
  contractKey: string;
  /**
   * Cradle singular key / Awilix default-slot alias. Defaults to {@link contractKey}; override via
   * `registrations[Contract][IOC_CONTRACT_CONFIG_KEY].accessKey`.
   */
  accessKey: string;
  /** Which implementation is selected for the default contract key (implementation name). */
  defaultImplementationName: string;
  implementations: ResolvedImplementationEntry[];
};

const DEFAULT_LIFETIME: IocLifetime = "singleton";

/**
 * Maps config-only `name` into the internal `registrationKey` field; applies `lifetime` / `default`
 * so merged {@link DiscoveredFactory} rows reflect `ioc.config` policy only (factory sources stay plain).
 */
export const normalizeIocOverride = (
  override: IocOverride,
): Partial<DiscoveredFactory> => {
  const {
    name,
    lifetime,
    default: defaultFlag,
    source: _source,
    allowLifetimeInversion: _allowLifetimeInversion,
    ...rest
  } = override;
  const out: Partial<DiscoveredFactory> = { ...rest };

  if (lifetime !== undefined) {
    out.lifetime = lifetime;
  }
  if (name !== undefined) {
    out.registrationKey = name;
  }
  if (Object.hasOwn(override, "default")) {
    out.default = override.default;
  } else if (override.default !== undefined) {
    out.default = override.default;
  }

  return out;
};

const mergeDiscoveredWithOverride = (
  factory: DiscoveredFactory,
  override: IocOverride | undefined,
): DiscoveredFactory => {
  if (override === undefined) {
    return factory;
  }

  return { ...factory, ...normalizeIocOverride(override) };
};

/**
 * If the contract's config sets `default` for any implementation (own or inherited via
 * `[[Get]]`), config owns default selection for that contract: discovered `default` flags are
 * ignored unless an override sets `default` on that implementation after merge.
 *
 * Uses `Object.hasOwn` for explicit `default: undefined` (config still owns policy) and
 * `override.default !== undefined` so inherited `default: true|false` from prototypes / helpers
 * is not ignored.
 */
const contractConfigSpecifiesDefault = (
  perContract: IocRegistrationsPerContract | undefined,
): boolean => {
  if (perContract === undefined) {
    return false;
  }

  return Object.entries(perContract).some(
    ([key, override]) =>
      key !== IOC_CONTRACT_CONFIG_KEY &&
      override !== undefined &&
      isIocImplementationOverride(override) &&
      (Object.hasOwn(override, "default") ||
        override.default !== undefined),
  );
};

const stripDiscoveredDefault = (
  factory: DiscoveredFactory,
): DiscoveredFactory => {
  const { default: _removed, ...rest } = factory;
  return rest;
};

const listImplFactories = (factories: readonly DiscoveredFactory[]): string =>
  Array.from(factories)
    .sort((a, b) => a.implementationName.localeCompare(b.implementationName))
    .map(
      (factory) =>
        `"${factory.implementationName}" (${factory.modulePath}, export ${factory.exportName})`,
    )
    .join("; ");

const selectDefaultImplementationKey = (
  contractName: string,
  mergedByImplName: Map<string, DiscoveredFactory>,
): string => {
  const factories = Array.from(mergedByImplName.values());
  const withDefault = factories.filter((factory) => factory.default === true);

  if (withDefault.length > 1) {
    throw new Error(
      `[ioc] Contract ${JSON.stringify(contractName)} has multiple implementations marked default: true after applying ioc.config overrides: ${listImplFactories(withDefault)}. Mark exactly one with default: true under registrations[${JSON.stringify(contractName)}][implementationName], or reduce to a single implementation.`,
    );
  }

  const rows = Array.from(mergedByImplName.entries()).map(
    ([implementationName, factory]) => ({
      implementationName,
      registrationKey: factory.registrationKey,
      ...(factory.default === true ? { default: true as const } : {}),
    }),
  );

  return selectDefaultImplementationName(contractName, rows);
};

const resolveLifetime = (factory: DiscoveredFactory): IocLifetime => {
  if (factory.lifetime !== undefined) {
    return factory.lifetime;
  }

  return DEFAULT_LIFETIME;
};

/**
 * Resolve Awilix lifetime for one implementation. Single precedence chain (no duplicate fallbacks):
 *
 * 1. `registrations[Contract][implementation].lifetime` → source `factory-config` in inspect output (means **ioc.config**, not factory source)
 * 2. Else lifetime marker on return type → source `lifetime-marker`
 * 3. Else discovery-root `discovery.scanDirs[].scope` for the factory file → source `discovery-root`
 * 4. Else {@link resolveLifetime} (existing behavior: merged factory lifetime or `singleton`) → source `default`
 */
const resolvePlanLifetime = (
  factory: DiscoveredFactory,
  implOverride: IocOverride | undefined,
  lifetimeContext: RegistrationPlanLifetimeContext | undefined,
): { lifetime: IocLifetime; lifetimeSource?: IocRegistrationLifetimeSource } => {
  if (implOverride?.lifetime !== undefined) {
    return {
      lifetime: implOverride.lifetime,
      ...(lifetimeContext !== undefined
        ? { lifetimeSource: "factory-config" as const }
        : {}),
    };
  }

  if (lifetimeContext?.markerLifetimesByFactoryKey !== undefined) {
    const markerLifetime = lifetimeContext.markerLifetimesByFactoryKey.get(
      `${factory.modulePath}:${factory.exportName}`,
    );
    if (markerLifetime !== undefined) {
      return {
        lifetime: markerLifetime,
        ...(lifetimeContext !== undefined
          ? { lifetimeSource: "lifetime-marker" as const }
          : {}),
      };
    }
  }

  if (lifetimeContext !== undefined) {
    const absPath = resolveFactorySourceAbsPath(
      factory.modulePath,
      lifetimeContext.projectRoot,
      lifetimeContext.scanDirs,
    );
    const fromRootScope = resolveDiscoveryRootDefaultLifetime(
      absPath,
      lifetimeContext.scanDirs,
    );
    if (fromRootScope !== undefined) {
      return {
        lifetime: fromRootScope,
        lifetimeSource: "discovery-root",
      };
    }
  }

  return {
    lifetime: resolveLifetime(factory),
    ...(lifetimeContext !== undefined ? { lifetimeSource: "default" as const } : {}),
  };
};

const assertUniqueContractTypeRelImport = (
  contractName: string,
  mergedByImplName: Map<string, DiscoveredFactory>,
): string => {
  let seen: string | undefined;

  for (const factory of mergedByImplName.values()) {
    if (seen === undefined) {
      seen = factory.contractTypeRelImport;
      continue;
    }

    if (factory.contractTypeRelImport !== seen) {
      throw new Error(
        `[ioc] contract "${contractName}": implementations disagree on contract type import source ("${seen}" vs "${factory.contractTypeRelImport}"). Factories: ${listImplFactories(Array.from(mergedByImplName.values()))}. Each factory must return the same contract type symbol.`,
      );
    }
  }

  if (seen === undefined) {
    throw new Error(
      `[ioc] internal error: no implementations for "${contractName}"`,
    );
  }

  return seen;
};

const mergeContractOverrides = (
  contractName: string,
  implByKey: Map<string, DiscoveredFactory>,
  config: IocConfig | undefined,
): Map<string, DiscoveredFactory> => {
  const perContract = config?.registrations?.[contractName];
  const configOwnsDefault = contractConfigSpecifiesDefault(perContract);
  const out = new Map<string, DiscoveredFactory>();

  for (const [implementationName, factory] of implByKey) {
    const base = configOwnsDefault ? stripDiscoveredDefault(factory) : factory;
    const override = getImplOverrideForImplementation(
      perContract,
      implementationName,
    );

    out.set(implementationName, mergeDiscoveredWithOverride(base, override));
  }

  return out;
};

const suggestContractName = (
  unknown: string,
  candidates: readonly string[],
): string | undefined => {
  const lower = unknown.toLowerCase();
  const exact = candidates.find((c) => c.toLowerCase() === lower);
  if (exact !== undefined) {
    return exact;
  }

  let best: string | undefined;
  let bestDist = 3;
  for (const candidate of candidates) {
    const dist = levenshteinDistance(unknown, candidate);
    if (dist > 0 && dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return bestDist <= 2 ? best : undefined;
};

const levenshteinDistance = (a: string, b: string): number => {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => 0),
  );
  for (let i = 0; i < rows; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j < cols; j++) {
    dp[0][j] = j;
  }
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
};

const formatComposedContractList = (
  composed: ComposedManifestContractNames,
): string => {
  const names: string[] = [];
  for (const [, contractNames] of Array.from(composed.byPackage.entries()).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    for (const name of Array.from(contractNames).sort((x, y) =>
      x.localeCompare(y),
    )) {
      names.push(name);
    }
  }
  return names.length > 0 ? names.join(", ") : "(none)";
};

export const validateConfigContractsExist = (
  config: IocConfig | undefined,
  localContractNames: Set<string>,
  composedContractNames?: ComposedManifestContractNames,
): void => {
  if (config?.registrations === undefined) {
    return;
  }

  for (const contract of Object.keys(config.registrations)) {
    const knownLocal = localContractNames.has(contract);
    const knownComposed =
      composedContractNames?.all.has(contract) ?? false;
    if (knownLocal || knownComposed) {
      continue;
    }

    const localList =
      Array.from(localContractNames).sort((a, b) => a.localeCompare(b)).join(", ") ||
      "(none)";
    const composedList =
      composedContractNames !== undefined
        ? formatComposedContractList(composedContractNames)
        : "(none)";
    const candidates = [
      ...Array.from(localContractNames),
      ...(composedContractNames !== undefined
        ? Array.from(composedContractNames.all)
        : []),
    ];
    const suggestion = suggestContractName(contract, candidates);
    const lines = [
      `[ioc-config] registrations references unknown contract ${JSON.stringify(contract)}.`,
      `Known local contracts: ${localList}.`,
      `Known contracts from composed packages: ${composedList}.`,
    ];
    if (suggestion !== undefined) {
      lines.push(`Did you mean: ${JSON.stringify(suggestion)}?`);
    }
    throw new Error(lines.join("\n"));
  }
};

/**
 * Every implementation key under `registrations[contract]` must match a discovered implementation
 * name for that contract (stable factory / resolver key from discovery).
 */
const validateConfigImplementationKeys = (
  config: IocConfig | undefined,
  contractMap: Map<string, Map<string, DiscoveredFactory>>,
): void => {
  if (config?.registrations === undefined) {
    return;
  }

  for (const [contractName, implOverrides] of Object.entries(
    config.registrations,
  )) {
    const discovered = contractMap.get(contractName);
    if (discovered === undefined) {
      continue;
    }

    for (const implKey of Object.keys(implOverrides)) {
      if (implKey === IOC_CONTRACT_CONFIG_KEY) {
        continue;
      }

      if (!discovered.has(implKey)) {
        throw new Error(
          `[ioc-config] registrations[${JSON.stringify(contractName)}][${JSON.stringify(implKey)}] is not a discovered implementation for that contract. Discovered implementations: ${Array.from(discovered.keys()).sort().join(", ")}`,
        );
      }
    }
  }
};

/**
 * Config may set `default: true` on at most one implementation per contract (semantic rule; distinct
 * from discovery defaults merged later).
 */
const validateAtMostOneConfigDefaultPerContract = (
  config: IocConfig | undefined,
): void => {
  if (config?.registrations === undefined) {
    return;
  }

  for (const [contractName, implOverrides] of Object.entries(
    config.registrations,
  )) {
    const withDefault = Object.entries(implOverrides).filter(
      ([key, override]) =>
        key !== IOC_CONTRACT_CONFIG_KEY &&
        override !== undefined &&
        isIocImplementationOverride(override) &&
        override.default === true,
    );

    if (withDefault.length > 1) {
      throw new Error(
        `[ioc-config] registrations[${JSON.stringify(contractName)}] sets default: true on multiple implementations (${withDefault
          .map(([key]) => JSON.stringify(key))
          .sort()
          .join(", ")}). At most one default per contract.`,
      );
    }
  }
};

type ImplRef = {
  contractName: string;
  implementationName: string;
};

/**
 * Effective Awilix key after overrides: `override.name` replaces the discovered
 * `registrationKey`; there is no secondary alias under the old key.
 *
 * The container namespace is flat: implementation keys must be globally unique and must not use
 * another contract’s default slot name (when that slot is registered as an alias) or a plural
 * collection slot name for multi-implementation contracts.
 */
const validateGlobalNamespaceCollisions = (
  mergedByContract: Map<string, Map<string, DiscoveredFactory>>,
  config: IocConfig | undefined,
): void => {
  const keyOwner = new Map<string, ImplRef>();

  const claimImplKey = (key: string, ref: ImplRef): void => {
    const existing = keyOwner.get(key);
    if (existing !== undefined) {
      throw new Error(
        `[ioc-config] global registration name collision on ${JSON.stringify(key)}: ${existing.contractName}.${existing.implementationName} and ${ref.contractName}.${ref.implementationName} both resolve to that Awilix key. Adjust resolver metadata or registrations[].name overrides so keys are unique across all contracts.`,
      );
    }

    keyOwner.set(key, ref);
  };

  for (const [contractName, merged] of mergedByContract) {
    for (const [implementationName, factory] of merged) {
      claimImplKey(factory.registrationKey, {
        contractName,
        implementationName,
      });
    }
  }

  const accessKeyByContract = new Map<string, string>();
  for (const contractName of mergedByContract.keys()) {
    const convention = contractNameToDefaultRegistrationKey(contractName);
    const { accessKey: configured } = getContractLevelConfig(
      config?.registrations?.[contractName],
      contractName,
    );

    accessKeyByContract.set(contractName, configured ?? convention);
  }

  const accessKeyOwnerContract = new Map<string, string>();
  for (const [contractName, accessKey] of accessKeyByContract) {
    const existing = accessKeyOwnerContract.get(accessKey);
    if (existing !== undefined) {
      throw new Error(
        `[ioc-config] contract access key ${JSON.stringify(accessKey)} is used by both ${JSON.stringify(existing)} and ${JSON.stringify(contractName)} ($contract.accessKey must be unique across contracts).`,
      );
    }

    accessKeyOwnerContract.set(accessKey, contractName);
  }

  for (const [contractName, merged] of mergedByContract) {
    const accessKey = accessKeyByContract.get(contractName)!;
    const defaultImplementationName = selectDefaultImplementationKey(
      contractName,
      merged,
    );
    const defaultKey = merged.get(defaultImplementationName)!.registrationKey;
    const { accessKey: configuredAccessKey } = getContractLevelConfig(
      config?.registrations?.[contractName],
      contractName,
    );
    const accessKeyExplicitlyConfigured = configuredAccessKey !== undefined;

    if (accessKeyExplicitlyConfigured && accessKey !== defaultKey) {
      for (const [implementationName, factory] of merged) {
        if (factory.registrationKey === accessKey) {
          throw new Error(
            `[ioc-config] contract ${JSON.stringify(contractName)}: access key ${JSON.stringify(accessKey)} from $contract is reserved for the default-slot alias (default implementation registers as ${JSON.stringify(defaultKey)}), but implementation ${JSON.stringify(implementationName)} uses that key.`,
          );
        }
      }
    }

    for (const [otherContractName, otherMerged] of mergedByContract) {
      if (otherContractName === contractName) {
        continue;
      }

      for (const [implementationName, factory] of otherMerged) {
        if (factory.registrationKey !== accessKey) {
          continue;
        }

        throw new Error(
          `[ioc-config] registration key ${JSON.stringify(accessKey)} is reserved as the contract default slot for ${JSON.stringify(contractName)} (the selected default implementation is registered as ${JSON.stringify(defaultKey)}). ${otherContractName}.${implementationName} cannot use ${JSON.stringify(accessKey)}. Choose a different resolver key or registrations[].name override.`,
        );
      }
    }
  }
};

/**
 * Semantic validation against discovery and the flat Awilix namespace. Reference checks and
 * config-only default rules run first; merged maps are built once to compute effective registration
 * keys and defaults for global collision checks, then the same merged maps are reused when
 * building the plan.
 */
const validateIocConfigSemantics = (
  contractMap: Map<string, Map<string, DiscoveredFactory>>,
  config: IocConfig | undefined,
  composedContractNames?: ComposedManifestContractNames,
): Map<string, Map<string, DiscoveredFactory>> => {
  const contractNames = new Set(contractMap.keys());

  validateConfigContractsExist(
    config,
    contractNames,
    composedContractNames,
  );
  validateConfigImplementationKeys(config, contractMap);
  validateAtMostOneConfigDefaultPerContract(config);

  const mergedByContract = new Map<string, Map<string, DiscoveredFactory>>();

  for (const [contractName, implementations] of contractMap) {
    const implByKey = new Map<string, DiscoveredFactory>();
    for (const [implementationName, factory] of implementations) {
      implByKey.set(implementationName, factory);
    }

    mergedByContract.set(
      contractName,
      mergeContractOverrides(contractName, implByKey, config),
    );
  }

  validateGlobalNamespaceCollisions(mergedByContract, config);

  return mergedByContract;
};

/**
 * Produces sorted `ResolvedContractRegistration[]` used by manifest serialization and group planning.
 * Throws on any config/discovery inconsistency (unknown contracts, duplicate defaults, key collisions).
 */
export const buildRegistrationPlan = (
  contractMap: Map<string, Map<string, DiscoveredFactory>>,
  config?: IocConfig,
  lifetimeContext?: RegistrationPlanLifetimeContext,
): ResolvedContractRegistration[] => {
  const mergedByContract = validateIocConfigSemantics(
    contractMap,
    config,
    lifetimeContext?.composedContractNames,
  );

  const sortedContracts = Array.from(mergedByContract.keys()).sort((a, b) =>
    a.localeCompare(b),
  );

  const out: ResolvedContractRegistration[] = [];

  for (const contractName of sortedContracts) {
    const mergedByImplName = mergedByContract.get(contractName)!;

    const defaultImplementationName = selectDefaultImplementationKey(
      contractName,
      mergedByImplName,
    );

    const contractTypeRelImport = assertUniqueContractTypeRelImport(
      contractName,
      mergedByImplName,
    );

    const contractKey = contractNameToDefaultRegistrationKey(contractName);
    const { accessKey: accessKeyOverride } = getContractLevelConfig(
      config?.registrations?.[contractName],
      contractName,
    );
    const accessKey = accessKeyOverride ?? contractKey;

    const implementationNames = Array.from(mergedByImplName.keys()).sort(
      (a, b) => a.localeCompare(b),
    );

    const contractLevelAccessKeyApplied =
      accessKeyOverride !== undefined && accessKeyOverride !== contractKey;

    const implementations: ResolvedImplementationEntry[] =
      implementationNames.map((implementationName) => {
        const factory = mergedByImplName.get(implementationName)!;
        const implOverride = getImplOverrideForImplementation(
          config?.registrations?.[contractName],
          implementationName,
        );

        const configOverridesApplied: IocConfigOverrideField[] = [];

        if (implOverride?.name !== undefined) {
          configOverridesApplied.push("name");
        }
        if (implOverride?.lifetime !== undefined) {
          configOverridesApplied.push("lifetime");
        }
        if (implOverride?.default !== undefined) {
          configOverridesApplied.push("default");
        }
        if (
          contractLevelAccessKeyApplied &&
          implementationName === defaultImplementationName
        ) {
          configOverridesApplied.push("accessKey");
        }

        const { lifetime, lifetimeSource } = resolvePlanLifetime(
          factory,
          implOverride,
          lifetimeContext,
        );

        return {
          implementationName,
          exportName: factory.exportName,
          modulePath: factory.modulePath,
          relImport: factory.relImport,
          registrationKey: factory.registrationKey,
          lifetime,
          ...(lifetimeSource !== undefined ? { lifetimeSource } : {}),
          ...(factory.discoveredBy !== undefined
            ? { discoveredBy: factory.discoveredBy }
            : {}),
          ...(configOverridesApplied.length > 0
            ? { configOverridesApplied }
            : {}),
          ...(factory.dependencyContractNames !== undefined &&
          factory.dependencyContractNames.length > 0
            ? { dependencyContractNames: factory.dependencyContractNames }
            : {}),
        };
      });

    out.push({
      contractName,
      contractTypeRelImport,
      contractKey,
      accessKey,
      defaultImplementationName,
      implementations,
    });
  }

  return out;
};
