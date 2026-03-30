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
import { selectDefaultImplementationName } from "../core/defaultImplementationSelection.js";
import type { DiscoveredFactory } from "./types.js";
import {
  contractNameToCollectionRegistrationKey,
  contractNameToDefaultRegistrationKey,
} from "./naming.js";

export type ResolvedImplementationEntry = {
  /** Stable implementation id from discovery (factory export / resolver map key). */
  implementationName: string;
  /** Awilix/container registration name (respects resolver `key` / `name`). */
  registrationKey: string;
  exportName: string;
  modulePath: string;
  relImport: string;
  lifetime: IocLifetime;
  discoveredBy?: "naming";
  /** Fields present on the matching `ioc.config` registration override for this implementation. */
  configOverridesApplied?: readonly IocConfigOverrideField[];
  dependencyContractNames?: readonly string[];
};

export type ResolvedContractRegistration = {
  contractName: string;
  /**
   * Type-only import path for the contract symbol (from discovery; same for all implementations).
   * Independent of which implementation is the runtime default.
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
  /** Plural collection key when there is more than one implementation; otherwise undefined. */
  collectionKey: string | undefined;
  /** Which implementation is selected for the default contract key (implementation name). */
  defaultImplementationName: string;
  implementations: ResolvedImplementationEntry[];
};

const DEFAULT_LIFETIME: IocLifetime = "singleton";

/**
 * Maps config-only `name` into the internal `registrationKey` field; spreads the rest so
 * future override keys that match {@link DiscoveredFactory} merge without extra wiring.
 */
export const normalizeIocOverride = (
  override: IocOverride,
): Partial<DiscoveredFactory> => {
  const { name, ...rest } = override;
  const out: Partial<DiscoveredFactory> = { ...rest };

  if (name !== undefined) {
    out.registrationKey = name;
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
 * If the contract's config mentions `default` for any implementation, config owns default
 * selection for that contract: discovered `default` flags are ignored unless an override
 * explicitly sets `default` for that implementation.
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
      Object.hasOwn(override, "default"),
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
      `[ioc] Contract ${JSON.stringify(contractName)} has multiple implementations marked default: true after applying ioc.config overrides: ${listImplFactories(withDefault)}. Mark exactly one with default: true in source or in registrations[${JSON.stringify(contractName)}][implementationName], or reduce to a single implementation.`,
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

export const validateConfigContractsExist = (
  config: IocConfig | undefined,
  contractNames: Set<string>,
): void => {
  if (config?.registrations === undefined) {
    return;
  }

  for (const contract of Object.keys(config.registrations)) {
    if (!contractNames.has(contract)) {
      throw new Error(
        `[ioc-config] registrations["${contract}"] refers to a contract that was not discovered. Discovered contracts: ${Array.from(contractNames).sort().join(", ")}`,
      );
    }
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

  for (const [contractName, accessKey] of accessKeyByContract) {
    for (const [otherContractName, otherMerged] of mergedByContract) {
      if (otherMerged.size <= 1) {
        continue;
      }

      const collectionKey =
        contractNameToCollectionRegistrationKey(otherContractName);
      if (accessKey === collectionKey) {
        throw new Error(
          `[ioc-config] access key ${JSON.stringify(accessKey)} for contract ${JSON.stringify(contractName)} collides with the collection slot ${JSON.stringify(collectionKey)} for contract ${JSON.stringify(otherContractName)}.`,
        );
      }
    }
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

  for (const [contractName, merged] of mergedByContract) {
    if (merged.size <= 1) {
      continue;
    }

    const collectionKey = contractNameToCollectionRegistrationKey(contractName);

    for (const [otherContractName, otherMerged] of mergedByContract) {
      for (const [implementationName, factory] of otherMerged) {
        if (factory.registrationKey === collectionKey) {
          throw new Error(
            `[ioc-config] registration key ${JSON.stringify(collectionKey)} is reserved as the collection slot for contract ${JSON.stringify(contractName)}. ${otherContractName}.${implementationName} cannot use that key. Choose a different resolver key or registrations[].name override.`,
          );
        }
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
): Map<string, Map<string, DiscoveredFactory>> => {
  const contractNames = new Set(contractMap.keys());

  validateConfigContractsExist(config, contractNames);
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
): ResolvedContractRegistration[] => {
  const mergedByContract = validateIocConfigSemantics(contractMap, config);

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
    const collectionKey =
      mergedByImplName.size > 1
        ? contractNameToCollectionRegistrationKey(contractName)
        : undefined;

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

        return {
          implementationName,
          exportName: factory.exportName,
          modulePath: factory.modulePath,
          relImport: factory.relImport,
          registrationKey: factory.registrationKey,
          lifetime: resolveLifetime(factory),
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
      collectionKey,
      defaultImplementationName,
      implementations,
    });
  }

  return out;
};
