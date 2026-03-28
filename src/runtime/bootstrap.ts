import {
  aliasTo,
  asFunction,
  Lifetime,
  type AwilixContainer,
  type NameAndRegistrationPair,
} from "awilix";
import type {
  IocBundlesManifest,
  IocContractManifest,
  IocModuleNamespace,
  ModuleFactoryManifestMetadata,
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
import {
  formatMissingDefaultImplementationMessage,
  formatMissingFactoryExportMessage,
  formatMissingModuleImportMessage,
} from "./iocRuntimeErrors.js";
import {
  buildRegistrationKeyIndex,
  type RegistrationKeyIndex,
} from "./registrationKeyIndex.js";

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
  const defaultImpl =
    implList.find((m) => m.default === true) ??
    (implList.length === 1 ? implList[0] : undefined);

  if (!defaultImpl) {
    if (implList.length === 0) {
      throw new Error(
        `[ioc] No implementation registered for contract ${JSON.stringify(contractName)} (no factories in the manifest for this contract). Add a discoverable factory and re-run manifest generation.`,
      );
    }
    throw new Error(
      formatMissingDefaultImplementationMessage({
        contractName,
        implementationNames: implList.map((m) => m.implementationName),
        registrationKeys: implList.map((m) => m.registrationKey),
      }),
    );
  }

  return defaultImpl;
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

const registerContractDefaultAliases = <TCradle extends object>(
  container: AwilixContainer<TCradle>,
  manifestByContract: IocContractManifest,
): void => {
  for (const [contractName, impls] of Object.entries(manifestByContract)) {
    const contractKey = contractNameToDefaultRegistrationKey(contractName);
    const implList = Object.values(impls);
    const defaultImpl = resolveDefaultImplementation(contractName, implList);

    const hasImplementationAtContractKey = implList.some(
      (meta) => meta.registrationKey === contractKey,
    );

    if (
      contractKey !== defaultImpl.registrationKey &&
      !hasImplementationAtContractKey
    ) {
      registerPair<TCradle>(container, {
        [contractKey]: aliasTo(defaultImpl.registrationKey),
      });
    }
  }
};

const registerImplementationCollections = <TCradle extends object>(
  container: AwilixContainer<TCradle>,
  manifestByContract: IocContractManifest,
  keyIndex: RegistrationKeyIndex,
): void => {
  for (const [contractName, impls] of Object.entries(manifestByContract)) {
    const implList = Object.values(impls);
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
            const map: Record<string, unknown> = {};

            for (const meta of implList) {
              map[meta.implementationName] =
                cradle[meta.registrationKey as keyof TCradle];
            }

            return map;
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

const resolveBundleNodeFromCradle = <TCradle extends object>(
  cradle: TCradle,
  node: IocBundlesManifest[string],
): unknown => {
  if (Array.isArray(node)) {
    return node.map((leaf) => cradle[leaf.registrationKey as keyof TCradle]);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = resolveBundleNodeFromCradle(cradle, value);
  }
  return out;
};

const registerBundles = <TCradle extends object>(
  container: AwilixContainer<TCradle>,
  bundlesManifest: IocBundlesManifest | undefined,
  keyIndex: RegistrationKeyIndex,
): void => {
  if (bundlesManifest === undefined) {
    return;
  }
  const rootKeys = Object.keys(bundlesManifest).sort((a, b) =>
    a.localeCompare(b),
  );
  for (const key of rootKeys) {
    const node = bundlesManifest[key]!;
    registerPair<TCradle>(container, {
      [key]: asFunction(
        (cradle: TCradle) => {
          pushIocResolutionFrame({
            contractName: key,
            implementationName: "(bundle)",
            registrationKey: key,
          });
          try {
            return resolveBundleNodeFromCradle(cradle, node);
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
 * Registers discovered injectable factories from a generated manifest into an Awilix container.
 * Call order:
 * 1. concrete implementation factories
 * 2. default contract aliases
 * 3. multi-implementation collections
 */
export const registerIocFromManifest = <TCradle extends object>(
  container: AwilixContainer<TCradle>,
  manifestByContract: IocContractManifest,
  moduleImports: readonly IocModuleNamespace[],
  bundlesManifest?: IocBundlesManifest,
): void => {
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
  registerBundles(container, bundlesManifest, keyIndex);
};
