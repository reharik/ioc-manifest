/**
 * @fileoverview Awilix wiring for generated manifests: register implementation factories, wire
 * default-slot aliases, plural collection keys, and transient group roots. Resolution errors are
 * normalized to {@link IocResolutionError} with manifest-aware stack traces.
 */
import {
  aliasTo,
  asFunction,
  Lifetime,
  type AwilixContainer,
  type NameAndRegistrationPair,
} from "awilix";
import {
  IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS,
  type IocContractManifest,
  type IocGroupNodeManifest,
  type IocGroupsManifest,
  type IocModuleNamespace,
  type IocRegisterableManifest,
  type ModuleFactoryManifestMetadata,
} from "../core/manifest.js";
import {
  contractNameToCollectionRegistrationKey,
  contractNameToDefaultRegistrationKey,
} from "../generator/naming.js";
import { propagateIocResolutionFailure } from "./iocResolutionError.js";
import {
  frameFromManifestMeta,
  popIocResolutionFrame,
  pushIocResolutionFrame,
  snapshotIocResolutionStack,
} from "./iocResolutionStack.js";
import { selectDefaultImplementationName } from "../core/defaultImplementationSelection.js";
import {
  formatMissingDefaultImplementationMessage,
  formatMissingFactoryExportMessage,
  formatMissingModuleImportMessage,
} from "./iocRuntimeErrors.js";
import {
  buildRegistrationKeyIndex,
  type RegistrationKeyIndex,
} from "./registrationKeyIndex.js";

/** Group-root entries only: strips fixed manifest keys (`moduleImports`, `contracts`). */
const extractGroupRootsFromContainerManifest = (
  manifest: IocRegisterableManifest,
): IocGroupsManifest => {
  const out: IocGroupsManifest = {};

  for (const key of Object.keys(manifest)) {
    if (IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS.has(key)) {
      continue;
    }

    const value = manifest[key];
    if (value === undefined) {
      continue;
    }

    /* Generated manifests only place `IocGroupNodeManifest` values on non-fixed keys. */
    out[key] = value as IocGroupNodeManifest;
  }

  return out;
};

const lifetimeToAwilix = (
  lifetime: "singleton" | "scoped" | "transient",
): (typeof Lifetime)[keyof typeof Lifetime] => {
  switch (lifetime) {
    case "singleton":
      return Lifetime.SINGLETON;
    case "scoped":
      return Lifetime.SCOPED;
    case "transient":
      return Lifetime.TRANSIENT;
    default: {
      const _exhaustive: never = lifetime;
      return _exhaustive;
    }
  }
};

const registerPair = <TCradle extends object>(
  container: AwilixContainer<TCradle>,
  pair: Record<string, unknown>,
): void => {
  /* Registration keys come from generated manifests; Awilix types cannot express this map statically. */
  container.register(pair as unknown as NameAndRegistrationPair<TCradle>);
};

const isFactoryFunction = (
  value: unknown,
): value is (...args: unknown[]) => unknown => typeof value === "function";

const invokeResolvedFactory = <TCradle extends object>(
  factory: unknown,
  cradle: TCradle,
  meta: ModuleFactoryManifestMetadata,
  keyIndex: RegistrationKeyIndex,
): unknown => {
  if (!isFactoryFunction(factory)) {
    throw new Error("[ioc] internal error: expected resolver factory function");
  }

  /**
   * Always pass the cradle.
   *
   * Why:
   * - `(deps) => Contract` obviously needs it
   * - `() => Contract` will safely ignore the extra argument in JS
   * - relying on `factory.length` is fragile for signatures like `(deps = {}) => ...`,
   *   which report `.length === 0` even though they conceptually accept dependencies
   */
  pushIocResolutionFrame(frameFromManifestMeta(meta));
  try {
    return factory(cradle);
  } catch (cause: unknown) {
    return propagateIocResolutionFailure({
      cause,
      keyIndex,
      stackSnapshot: snapshotIocResolutionStack(),
    });
  } finally {
    popIocResolutionFrame();
  }
};

const collectionLifetimeFromImplementations = (
  impls: readonly ModuleFactoryManifestMetadata[],
): (typeof Lifetime)[keyof typeof Lifetime] => {
  /**
   * The collection resolves and returns concrete implementation instances.
   * Its lifetime therefore must not outlive any member it captures.
   *
   * - if any member is transient, collection must be transient
   * - else if any member is scoped, collection must be scoped
   * - else singleton is safe
   */
  if (impls.some((meta) => meta.lifetime === "transient")) {
    return Lifetime.TRANSIENT;
  }
  if (impls.some((meta) => meta.lifetime === "scoped")) {
    return Lifetime.SCOPED;
  }
  return Lifetime.SINGLETON;
};

const resolveDefaultImplementation = (
  contractName: string,
  implList: readonly ModuleFactoryManifestMetadata[],
): ModuleFactoryManifestMetadata => {
  if (implList.length === 0) {
    throw new Error(
      `[ioc] No implementation registered for contract ${JSON.stringify(contractName)} (no factories in the manifest for this contract). Add a discoverable factory and re-run manifest generation.`,
    );
  }

  const rows = implList.map((m) => ({
    implementationName: m.implementationName,
    registrationKey: m.registrationKey,
    ...(m.default === true ? { default: true as const } : {}),
  }));

  try {
    const name = selectDefaultImplementationName(contractName, rows);
    const defaultImpl = implList.find((m) => m.implementationName === name);
    if (defaultImpl === undefined) {
      throw new Error(
        `[ioc] internal error: selected default ${JSON.stringify(name)} missing from manifest for ${JSON.stringify(contractName)}`,
      );
    }
    return defaultImpl;
  } catch (cause: unknown) {
    if (implList.length > 1) {
      throw new Error(
        formatMissingDefaultImplementationMessage({
          contractName,
          implementationNames: implList.map((m) => m.implementationName),
          registrationKeys: implList.map((m) => m.registrationKey),
        }),
        { cause },
      );
    }
    throw cause;
  }
};

const registerImplementationFactories = <TCradle extends object>(
  container: AwilixContainer<TCradle>,
  manifestByContract: IocContractManifest,
  moduleImports: readonly IocModuleNamespace[],
  keyIndex: RegistrationKeyIndex,
): void => {
  for (const impls of Object.values(manifestByContract)) {
    for (const meta of Object.values(impls)) {
      const ns = moduleImports[meta.moduleIndex];
      if (!ns) {
        throw new Error(
          formatMissingModuleImportMessage({
            moduleIndex: meta.moduleIndex,
            modulePath: meta.modulePath,
          }),
        );
      }

      const factory = ns[meta.exportName];
      if (typeof factory !== "function") {
        throw new Error(
          formatMissingFactoryExportMessage({
            modulePath: meta.modulePath,
            exportName: meta.exportName,
            contractName: meta.contractName,
            registrationKey: meta.registrationKey,
          }),
        );
      }

      registerPair<TCradle>(container, {
        [meta.registrationKey]: asFunction(
          (cradle: TCradle) =>
            invokeResolvedFactory(factory, cradle, meta, keyIndex),
          { lifetime: lifetimeToAwilix(meta.lifetime) },
        ),
      });
    }
  }
};

const resolveManifestAccessKey = (
  contractName: string,
  implList: readonly ModuleFactoryManifestMetadata[],
): string => {
  const explicit = implList.find((m) => m.accessKey !== undefined)?.accessKey;
  if (explicit !== undefined) {
    return explicit;
  }
  return contractNameToDefaultRegistrationKey(contractName);
};

const registerContractDefaultAliases = <TCradle extends object>(
  container: AwilixContainer<TCradle>,
  manifestByContract: IocContractManifest,
): void => {
  for (const [contractName, impls] of Object.entries(manifestByContract)) {
    const implList = Object.values(impls);
    const accessKey = resolveManifestAccessKey(contractName, implList);
    const defaultImpl = resolveDefaultImplementation(contractName, implList);

    const hasImplementationAtAccessKey = implList.some(
      (meta) => meta.registrationKey === accessKey,
    );

    if (
      accessKey !== defaultImpl.registrationKey &&
      !hasImplementationAtAccessKey
    ) {
      registerPair<TCradle>(container, {
        [accessKey]: aliasTo(defaultImpl.registrationKey),
      });
    }
  }
};

/**
 * Registers the automatic per-contract multi-implementation slot: plural collection key →
 * **array** of all concrete implementations (sorted by `registrationKey`), independent of
 * configured group roots in the human manifest.
 */
const registerImplementationCollections = <TCradle extends object>(
  container: AwilixContainer<TCradle>,
  manifestByContract: IocContractManifest,
  keyIndex: RegistrationKeyIndex,
): void => {
  for (const [contractName, impls] of Object.entries(manifestByContract)) {
    const implList = [...Object.values(impls)].sort((a, b) =>
      a.registrationKey.localeCompare(b.registrationKey),
    );
    if (implList.length <= 1) {
      continue;
    }

    const collectionKey = contractNameToCollectionRegistrationKey(contractName);
    const collectionLifetime = collectionLifetimeFromImplementations(implList);

    registerPair<TCradle>(container, {
      [collectionKey]: asFunction(
        (cradle: TCradle) => {
          pushIocResolutionFrame({
            contractName,
            implementationName: "(collection)",
            registrationKey: collectionKey,
          });
          try {
            return implList.map(
              (meta) => cradle[meta.registrationKey as keyof TCradle],
            );
          } catch (cause: unknown) {
            return propagateIocResolutionFailure({
              cause,
              keyIndex,
              stackSnapshot: snapshotIocResolutionStack(),
            });
          } finally {
            popIocResolutionFrame();
          }
        },
        { lifetime: collectionLifetime },
      ),
    });
  }
};

const resolveGroupNodeFromCradle = <TCradle extends object>(
  cradle: TCradle,
  node: IocGroupNodeManifest,
): unknown => {
  if (Array.isArray(node)) {
    return node.map((leaf) => cradle[leaf.registrationKey as keyof TCradle]);
  }
  const out: Record<string, unknown> = {};
  for (const [propKey, leaf] of Object.entries(node)) {
    out[propKey] = cradle[leaf.registrationKey as keyof TCradle];
  }
  return out;
};

const registerGroups = <TCradle extends object>(
  container: AwilixContainer<TCradle>,
  groupsManifest: IocGroupsManifest | undefined,
  keyIndex: RegistrationKeyIndex,
): void => {
  if (groupsManifest === undefined) {
    return;
  }
  const rootKeys = Object.keys(groupsManifest).sort((a, b) =>
    a.localeCompare(b),
  );
  for (const key of rootKeys) {
    const node = groupsManifest[key]!;
    registerPair<TCradle>(container, {
      [key]: asFunction(
        (cradle: TCradle) => {
          pushIocResolutionFrame({
            contractName: key,
            implementationName: "(group)",
            registrationKey: key,
          });
          try {
            return resolveGroupNodeFromCradle(cradle, node);
          } catch (cause: unknown) {
            return propagateIocResolutionFailure({
              cause,
              keyIndex,
              stackSnapshot: snapshotIocResolutionStack(),
            });
          } finally {
            popIocResolutionFrame();
          }
        },
        { lifetime: Lifetime.TRANSIENT },
      ),
    });
  }
};

/**
 * Registers everything described by a generated container manifest into an Awilix container
 * (implementation factories, default access-key aliases, plural collection keys, and group roots).
 */
export const registerIocFromManifest = <TCradle extends object>(
  container: AwilixContainer<TCradle>,
  manifest: IocRegisterableManifest,
): void => {
  const { contracts: manifestByContract, moduleImports } = manifest;
  const groupsManifest = extractGroupRootsFromContainerManifest(manifest);
  const keyIndex = buildRegistrationKeyIndex(manifestByContract);
  registerImplementationFactories(
    container,
    manifestByContract,
    moduleImports,
    keyIndex,
  );
  registerContractDefaultAliases(container, manifestByContract);
  registerImplementationCollections(
    container,
    manifestByContract,
    keyIndex,
  );
  registerGroups(container, groupsManifest, keyIndex);
};
