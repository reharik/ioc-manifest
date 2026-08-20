/**
 * @fileoverview Awilix wiring for generated manifests: register implementation factories, wire
 * default-slot aliases, and transient group roots. Resolution errors are
 * normalized to {@link IocResolutionError} with manifest-aware stack traces.
 */
import {
  aliasTo,
  asFunction,
  asValue,
  Lifetime,
  type AwilixContainer,
  type NameAndRegistrationPair,
} from "awilix";
import {
  IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS,
  iocUnitKindOf,
  type IocContractManifest,
  type IocGroupNodeManifest,
  type IocGroupRootManifest,
  type IocGroupsManifest,
  type IocModuleNamespace,
  type IocRegisterableManifest,
  type IocScopeRootsManifest,
  type ModuleFactoryManifestMetadata,
  type ScopeRootVariantManifestMetadata,
} from "../core/manifest.js";
import { contractNameToDefaultRegistrationKey } from "../generator/naming.js";
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
import { prepareManifestsForRegistration } from "./composeManifests.js";
import type { ComposedRegistrationOverrides } from "./composedOverrides.js";

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

    /* Since schema v2: top-level group roots are `IocGroupRootManifest` wrappers. */
    out[key] = value as IocGroupRootManifest;
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

type UnitConstructor = new (cradle: unknown) => unknown;

/**
 * Produces one instance of a registration unit from the cradle.
 *
 * This is the ONLY place the unit kind is consulted at runtime: a factory is called, a class is
 * constructed. Both receive the cradle as their single argument, which is precisely Awilix PROXY
 * injection — `asClass(Ctor, { injectionMode: PROXY })` does `new Ctor(cradle)` and nothing else.
 *
 * Construction goes through the shared instrumented path below (rather than handing the class to
 * `asClass` and letting Awilix construct it) so that the {@link IocResolutionError} machinery stays
 * unit-kind agnostic: class units get the same manifest-aware resolution frames, headline, and
 * chain rendering as factory units. Registering a class through `asClass` directly would leave the
 * frame stack empty for that node and let a raw `AwilixResolutionError` escape a root resolve.
 */
const unitInstantiator = (
  exportValue: unknown,
  meta: ModuleFactoryManifestMetadata,
): ((cradle: unknown) => unknown) => {
  if (!isFactoryFunction(exportValue)) {
    throw new Error("[ioc] internal error: expected resolver factory function");
  }

  if (iocUnitKindOf(meta.kind) === "class") {
    const Ctor = exportValue as unknown as UnitConstructor;
    return (cradle) => new Ctor(cradle);
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
  return (cradle) => exportValue(cradle);
};

const invokeResolvedUnit = <TCradle extends object>(
  instantiate: (cradle: unknown) => unknown,
  cradle: TCradle,
  meta: ModuleFactoryManifestMetadata,
  keyIndex: RegistrationKeyIndex,
): unknown => {
  pushIocResolutionFrame(frameFromManifestMeta(meta));
  try {
    return instantiate(cradle);
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

      const exported = ns[meta.exportName];
      if (typeof exported !== "function") {
        throw new Error(
          formatMissingFactoryExportMessage({
            modulePath: meta.modulePath,
            exportName: meta.exportName,
            contractName: meta.contractName,
            registrationKey: meta.registrationKey,
          }),
        );
      }

      const instantiate = unitInstantiator(exported, meta);

      registerPair<TCradle>(container, {
        [meta.registrationKey]: asFunction(
          (cradle: TCradle) =>
            invokeResolvedUnit(instantiate, cradle, meta, keyIndex),
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

/** Contract names used as a group's base type (mirrors the generator's `groups.<name>.baseType`). */
const groupBaseTypeNamesFromManifest = (
  groupsManifest: IocGroupsManifest | undefined,
): ReadonlySet<string> =>
  new Set(
    Object.values(groupsManifest ?? {}).map((root) => root.baseType),
  );

/**
 * True when a group-base contract elects no default (no impl marked `default: true`) — mirrors the
 * generator's `isGroupBaseWithoutElectedDefault` exactly. Such a base emits no singular
 * contract-default key, so runtime must skip default-alias election for it (otherwise a base whose
 * narrowed members collapse to ≥2 impls under one contract aborts boot with "no default selected").
 */
const isGroupBaseWithoutElectedDefault = (
  contractName: string,
  implList: readonly ModuleFactoryManifestMetadata[],
  groupBaseTypeNames: ReadonlySet<string>,
): boolean =>
  groupBaseTypeNames.has(contractName) &&
  !implList.some((meta) => meta.default === true);

const registerContractDefaultAliases = <TCradle extends object>(
  container: AwilixContainer<TCradle>,
  manifestByContract: IocContractManifest,
  groupBaseTypeNames: ReadonlySet<string>,
): void => {
  for (const [contractName, impls] of Object.entries(manifestByContract)) {
    const implList = Object.values(impls);

    /* A group base with no elected default emits no singular key at generation time; do not elect
       one at boot — mirrors generation's `contractDefaultElected === false`. A group base that DOES
       mark an impl `default: true` falls through and registers that default as normal. */
    if (
      isGroupBaseWithoutElectedDefault(contractName, implList, groupBaseTypeNames)
    ) {
      continue;
    }

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
    const root = groupsManifest[key]!;
    registerPair<TCradle>(container, {
      [key]: asFunction(
        (cradle: TCradle) => {
          pushIocResolutionFrame({
            contractName: key,
            implementationName: "(group)",
            registrationKey: key,
          });
          try {
            return resolveGroupNodeFromCradle(cradle, root.members);
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
 * Resolution frame for a scope-root variant, in the shape the instrumented path expects.
 *
 * A variant is not in `contracts` — it claims no root-cradle key — so it has no
 * {@link ModuleFactoryManifestMetadata} of its own. This adapts its row to one so that a failure
 * while opening a scope renders with the same manifest-aware chain a root resolve does.
 */
const scopeRootVariantAsFrameMeta = (
  meta: ScopeRootVariantManifestMetadata,
): ModuleFactoryManifestMetadata => ({
  ...(meta.kind !== undefined ? { kind: meta.kind } : {}),
  exportName: meta.exportName,
  registrationKey: meta.variantKey,
  modulePath: meta.modulePath,
  relImport: meta.relImport,
  contractName: meta.contractName,
  implementationName: meta.variantName,
  lifetime: "scoped",
  moduleIndex: meta.moduleIndex,
});

/** What an opener hands back: the eagerly-resolved variant under its own key, plus a disposer. */
type OpenedScope = Record<string, unknown> & {
  dispose: () => Promise<void>;
};

const formatMissingLateBoundValueMessage = (
  meta: ScopeRootVariantManifestMetadata,
  key: string,
): string =>
  `[ioc] Opening scope ${JSON.stringify(meta.openerKey)} (scope root ${JSON.stringify(meta.contractName)}, variant ${JSON.stringify(meta.variantName)}): the declared late-bound value ${JSON.stringify(key)} was not supplied. Declared late-bound values: ${meta.lbvKeys.join(", ")}. The generated opener signature requires all of them at every call — a caller reaching this message is bypassing it (untyped JavaScript, a cast, or a spread of a partial object).`;

/**
 * The opener itself, closed over the scope that resolved it.
 *
 * Creating the child scope from `resolvingScope` is what makes an opener injectable anywhere: the
 * chain above it resolves for free through Awilix's parent lookup (registrations, externals), while
 * the late-bound values are passed explicitly at every call. No `AwilixContainer` reaches the
 * caller — the container handle stays inside this closure, which is the whole point of the opener
 * replacing hand-authored `AwilixContainer<RequestScope>` view types.
 *
 * Disposal is **async** because `AwilixContainer.dispose()` is: it returns the promise Awilix
 * returns rather than dropping it, so `await close()` really does wait for the scope's disposers.
 * Double-dispose is a no-op — the first call's promise is memoized and handed back unchanged, so a
 * second close neither disposes twice nor resolves before the first one has finished.
 */
const createScopeOpener = <TCradle extends object>(
  resolvingScope: AwilixContainer<TCradle>,
  meta: ScopeRootVariantManifestMetadata,
  instantiate: (cradle: unknown) => unknown,
  keyIndex: RegistrationKeyIndex,
): ((lbv: Record<string, unknown>) => OpenedScope) => {
  const frameMeta = scopeRootVariantAsFrameMeta(meta);

  return (lbv: Record<string, unknown>): OpenedScope => {
    const scope = resolvingScope.createScope();
    const pair: Record<string, unknown> = {};

    for (const key of meta.lbvKeys) {
      if (lbv === null || typeof lbv !== "object" || !(key in lbv)) {
        throw new Error(formatMissingLateBoundValueMessage(meta, key));
      }
      pair[key] = asValue(lbv[key]);
    }

    /* Same routing every registration unit gets, so the instrumented resolution-error path covers
       the variant exactly as it covers an ordinary factory. Scoped: the variant belongs to the
       scope that was just opened for it. */
    pair[meta.variantKey] = asFunction(
      (cradle: unknown) =>
        invokeResolvedUnit(
          instantiate,
          cradle as object,
          frameMeta,
          keyIndex,
        ),
      { lifetime: Lifetime.SCOPED },
    );

    registerPair(scope, pair);

    let disposal: Promise<void> | undefined;
    return {
      /* Resolved eagerly: one container, one resolve. A scope that wants a second thing is missing
         the unit that composes them, so there is no lazy handle and no multi-resolve view here. */
      [meta.variantKey]: scope.resolve(meta.variantKey),
      dispose: (): Promise<void> => (disposal ??= scope.dispose()),
    };
  };
};

const registerScopeRootOpeners = <TCradle extends object>(
  container: AwilixContainer<TCradle>,
  scopeRoots: IocScopeRootsManifest | undefined,
  moduleImports: readonly IocModuleNamespace[],
  keyIndex: RegistrationKeyIndex,
): void => {
  for (const variants of Object.values(scopeRoots ?? {})) {
    for (const meta of Object.values(variants)) {
      const ns = moduleImports[meta.moduleIndex];
      if (!ns) {
        throw new Error(
          formatMissingModuleImportMessage({
            moduleIndex: meta.moduleIndex,
            modulePath: meta.modulePath,
          }),
        );
      }

      const exported = ns[meta.exportName];
      if (typeof exported !== "function") {
        throw new Error(
          formatMissingFactoryExportMessage({
            modulePath: meta.modulePath,
            exportName: meta.exportName,
            contractName: meta.contractName,
            registrationKey: meta.variantKey,
          }),
        );
      }

      const instantiate = unitInstantiator(
        exported,
        scopeRootVariantAsFrameMeta(meta),
      );

      /* A bare resolver rather than `asFunction`: the opener has to close over the CONTAINER that
         resolved it, and only a resolver's own `resolve(container)` is handed that. `asFunction`
         receives the cradle, which cannot create a scope. Transient for the same reason group roots
         are — the opener is a closure, so caching it would only pin it to the wrong scope. */
      registerPair<TCradle>(container, {
        [meta.openerKey]: {
          lifetime: Lifetime.TRANSIENT,
          resolve: (resolvingScope: AwilixContainer<object>) =>
            createScopeOpener(resolvingScope, meta, instantiate, keyIndex),
        },
      });
    }
  }
};

/**
 * Registers everything described by a generated container manifest into an Awilix container
 * (implementation factories, default access-key aliases, group roots, and scope-root openers).
 */
export const registerIocFromManifest = <TCradle extends object>(
  container: AwilixContainer<TCradle>,
  manifests: readonly IocRegisterableManifest[],
  overrides?: ComposedRegistrationOverrides,
): void => {
  const manifest = prepareManifestsForRegistration(manifests, overrides);
  const { contracts: manifestByContract, moduleImports } = manifest;
  const groupsManifest = extractGroupRootsFromContainerManifest(manifest);
  const keyIndex = buildRegistrationKeyIndex(manifestByContract);
  registerImplementationFactories(
    container,
    manifestByContract,
    moduleImports,
    keyIndex,
  );
  registerContractDefaultAliases(
    container,
    manifestByContract,
    groupBaseTypeNamesFromManifest(groupsManifest),
  );
  registerGroups(container, groupsManifest, keyIndex);
  registerScopeRootOpeners(
    container,
    manifest.scopeRoots,
    moduleImports,
    keyIndex,
  );
};
