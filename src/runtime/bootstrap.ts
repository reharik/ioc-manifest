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
} from "awilix";
import {
  IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS,
  iocUnitKindOf,
  type IocContractManifest,
  type IocGroupLeafManifest,
  type IocGroupNodeManifest,
  type IocGroupRootManifest,
  type IocGroupsManifest,
  type IocModuleNamespace,
  type IocRegisterableManifest,
  type IocScopeRootsManifest,
  type ModuleFactoryManifestMetadata,
  type ScopeRootVariantManifestMetadata,
} from "../core/manifest.js";
import { resolveManifestAccessKey } from "../core/contractAccessKey.js";
import { groupedContractNamesFromManifest } from "../core/groupedContractNames.js";
import { propagateIocResolutionFailure } from "./iocResolutionError.js";
import {
  frameFromManifestMeta,
  popIocResolutionFrame,
  pushIocResolutionFrame,
  snapshotIocResolutionStack,
  IOC_GROUP_FRAME_IMPLEMENTATION_NAME,
  type IocResolutionFrame,
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
  /* Registration keys come from generated manifests; Awilix types cannot express this map
     statically. Since awilix 13, `NameAndRegistrationPair` maps every cradle key to a possibly
     `undefined` resolver, which `register` itself no longer accepts — so the cast lands on the
     parameter type `register` actually declares rather than on the pair type. */
  (container.register as (pair: Record<string, unknown>) => unknown)(pair);
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

const registerContractDefaultAliases = <TCradle extends object>(
  container: AwilixContainer<TCradle>,
  manifestByContract: IocContractManifest,
  groupedContractNames: ReadonlySet<string>,
): void => {
  for (const [contractName, impls] of Object.entries(manifestByContract)) {
    const implList = Object.values(impls);

    /* Grouped ⇒ group-only: a grouped contract backs no default slot at generation time, so do not
       elect one at boot either. Registering an alias the emitted cradle does not carry would be a
       key resolvable at runtime that no consumer may legally name — the divergence this mirrors
       generation to avoid. Member registration keys stay registered: the group resolver hands its
       members out by registration key, so the container must hold them even though the typed
       surface does not expose them. */
    if (groupedContractNames.has(contractName)) {
      continue;
    }

    const accessKey = resolveManifestAccessKey(contractName, implList);
    const defaultImpl = resolveDefaultImplementation(contractName, implList);

    const hasImplementationAtAccessKey = implList.some(
      (meta) => meta.registrationKey === accessKey,
    );

    /* Awilix holds one registration per name, so an implementation already registered UNDER the
       access key owns it and no alias can be written over the top.

       Generation now guarantees that such an occupant IS the electee — a registration occupying its
       contract's slot key without being elected is a hard error at `ioc generate` and in
       `ioc validate` alike (see `core/contractSlotOccupancy.ts`). So for any manifest this tool
       produced, `hasImplementationAtAccessKey` implies `accessKey === defaultImpl.registrationKey`
       and the second clause decides nothing: there is no shadow-divergent corner left for boot to
       have an opinion about.

       It stays because boot is not the gate. `registerIocFromManifest` accepts any manifest handed
       to it, including one emitted by an older version or assembled by hand, and the honest
       behaviour there is the container's own — the occupant keeps the name it is registered under —
       not a crash at startup over a file the caller may not own. */
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

/** The `(group)` hop, so a failure below a group renders the group it came through. */
const groupResolutionFrame = (groupKey: string): IocResolutionFrame => ({
  contractName: groupKey,
  implementationName: IOC_GROUP_FRAME_IMPLEMENTATION_NAME,
  registrationKey: groupKey,
});

/**
 * One member slot of a group value: resolved on first read, memoized after.
 *
 * The cradle is CAPTURED here, at group-value construction, not read from anywhere later. That is
 * what keeps laziness scope-correct: a group resolved out of a request scope hands its members that
 * scope's cradle however long after the fact they are first read, so two scopes resolving the same
 * group key get their own members, and a repeated read inside one scope gets the same instance the
 * cradle would have handed out.
 *
 * The memo caches the VALUE, not a failure — a throw leaves the slot unresolved, so a second read
 * re-resolves and fails the same way rather than replaying a stale error with the wrong chain.
 */
const groupMemberAccessor = <TCradle extends object>(
  cradle: TCradle,
  groupKey: string,
  memberLabel: string,
  leaf: IocGroupLeafManifest,
  keyIndex: RegistrationKeyIndex,
): (() => unknown) => {
  let memo: unknown;
  let resolved = false;

  return (): unknown => {
    if (resolved) {
      return memo;
    }

    pushIocResolutionFrame(groupResolutionFrame(groupKey));
    try {
      memo = cradle[leaf.registrationKey as keyof TCradle];
      resolved = true;
      return memo;
    } catch (cause: unknown) {
      return propagateIocResolutionFailure({
        cause,
        keyIndex,
        stackSnapshot: snapshotIocResolutionStack(),
        groupHop: { groupKey, memberLabel },
      });
    } finally {
      popIocResolutionFrame();
    }
  };
};

/**
 * Builds a group value whose members resolve LAZILY.
 *
 * Building eagerly — `out[prop] = cradle[key]` for every member — made resolving a group construct
 * every member of it, which manufactured a cycle out of the one consumption pattern grouped-member
 * demand leaves open. A member reaching a sibling through the group is the ONLY road to that
 * sibling; taking it meant the group was mid-construction on Awilix's stack when the member named
 * it, and Awilix reported a cycle for a graph that has none.
 *
 * Getters remove the manufactured half. Resolving a group resolves no members, so the group value
 * exists immediately and the sibling resolves normally at the moment it is read. What is left that
 * still fails is a genuine cycle: a unit that reads a member property while it is itself still under
 * construction, and building that member leads back to it. That surfaces through the ordinary
 * {@link IocResolutionError} path with the `(group)` frame in the chain and a note naming the read.
 *
 * Both kinds get the same treatment. A collection's value stays a real array — `Array.isArray`,
 * `length`, indexing, spread and iteration all behave — whose elements are accessor properties, so
 * a consumer that holds the array and iterates it at call time constructs nothing at construction
 * time either. Member payloads are one level deep (a leaf is a `{ contractName, registrationKey }`
 * row, never another node), so there is no recursion to carry the treatment into.
 *
 * The one JS semantic this cannot hide: spreading or otherwise enumerating-and-reading the value
 * triggers every getter, which resolves every member. Hold the group and read what you need.
 * `console.log`/`util.inspect` is safe as-is — Node renders an unread slot as `[Getter]` rather than
 * invoking it — so no custom inspect hook is installed.
 */
const lazyGroupValueFromCradle = <TCradle extends object>(
  cradle: TCradle,
  groupKey: string,
  node: IocGroupNodeManifest,
  keyIndex: RegistrationKeyIndex,
): unknown => {
  if (Array.isArray(node)) {
    const out: unknown[] = [];
    node.forEach((leaf, index) => {
      Object.defineProperty(out, index, {
        get: groupMemberAccessor(
          cradle,
          groupKey,
          `[${index}]`,
          leaf,
          keyIndex,
        ),
        enumerable: true,
        configurable: true,
      });
    });
    return out;
  }

  const out: Record<string, unknown> = {};
  for (const [propKey, leaf] of Object.entries(node)) {
    Object.defineProperty(out, propKey, {
      get: groupMemberAccessor(cradle, groupKey, propKey, leaf, keyIndex),
      enumerable: true,
      configurable: true,
    });
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
    /* No frame push and no try/catch around the build itself: assembling the value resolves
       nothing, so nothing here can fail. The `(group)` frame moved onto the member accessors,
       where the hop now actually happens.

       `isLeakSafe` because a group root's TRANSIENT lifetime is a registration detail, not a claim
       about how long the value lives. It is transient so the aggregate is never cached into the
       wrong scope; it holds no member instances at construction (they are lazy slots) and no state
       of its own. Without the flag, strict mode would read that detail as a leak and refuse every
       singleton or scoped consumer of any group. The edges that genuinely matter — consumer to
       MEMBER — are ranked at generation through the group hop, which is also the only place they
       can be ranked; see the blind-spot note on `registerIocFromManifest`. */
    registerPair<TCradle>(container, {
      [key]: {
        ...asFunction(
          (cradle: TCradle) =>
            lazyGroupValueFromCradle(cradle, key, root.members, keyIndex),
          { lifetime: Lifetime.TRANSIENT },
        ),
        isLeakSafe: true,
      },
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
): ((lbv?: Record<string, unknown>) => OpenedScope) => {
  const frameMeta = scopeRootVariantAsFrameMeta(meta);

  // The parameter is optional here because a variant may declare no late-bound values at all: the
  // emitted signature for that opener takes no argument, so the call arrives with none. Nothing
  // else changes — the loop below has nothing to register, and every declared key of a variant that
  // DOES declare some is still checked against what was supplied.
  return (lbv?: Record<string, unknown>): OpenedScope => {
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
        invokeResolvedUnit(instantiate, cradle as object, frameMeta, keyIndex),
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
          /* Same reasoning as a group root: transient so the closure is never pinned to the wrong
             scope, and it holds nothing — it creates a child scope per call. Strict mode would
             otherwise refuse to inject an opener into any singleton or scoped unit, which is the
             ordinary way an opener is consumed. What the opener BUILDS is checked normally: the
             variant resolves inside the scope it just created, with its own resolution stack. */
          isLeakSafe: true,
          resolve: (resolvingScope: AwilixContainer<object>) =>
            createScopeOpener(resolvingScope, meta, instantiate, keyIndex),
        },
      });
    }
  }
};

/** Runtime options for {@link registerIocFromManifest}. */
export type IocRuntimeOptions = {
  /**
   * Awilix strict mode, **on by default**.
   *
   * Strict mode is Awilix's runtime correctness net. The check that matters here is lifetime
   * leakage: a longer-lived unit holding a shorter-lived dependency throws an
   * `AwilixResolutionError` at first resolve rather than quietly freezing the first instance it was
   * handed. It also refuses to register a singleton on a scoped container, and resolves singletons
   * against the root container so a singleton cannot capture a scope.
   *
   * This is set on the container passed in — `container.options.strict`, which Awilix reads at
   * resolve time — so it applies to that container and every scope opened from it afterwards.
   * Passing an explicit value is authoritative: `{ strict: false }` turns it off even for a
   * container created with `createContainer({ strict: true })`.
   *
   * **Turning it off is a decision, not a default to drift into.** Generation ranks the same edges
   * statically, but ranks two of them as WARNINGS where strict errors: `singleton → transient` and
   * `scoped → transient`. A warned edge resolves fine with `strict: false` and throws with it on.
   * `allowLifetimeInversion` in `ioc.config` suppresses the static REPORT only — it is not a
   * runtime exemption, and suppressing it does not stop strict from throwing.
   */
  strict?: boolean;
};

/**
 * Registers everything described by a generated container manifest into an Awilix container
 * (implementation factories, default access-key aliases, group roots, and scope-root openers).
 *
 * **Strict mode is enabled unless you opt out** (see {@link IocRuntimeOptions.strict}).
 *
 * One boundary is worth stating because nothing enforces it at runtime: strict backstops DIRECT
 * dependency edges, the ones Awilix resolves with the consumer on its resolution stack. It does not
 * see an edge that runs through a GROUP. Group member slots resolve lazily — the read usually
 * happens at call time, long after any enclosing `resolve()` has returned — so there is no
 * resolution stack for Awilix to rank the member against. Consumer → group → member edges are
 * therefore checked at generation and nowhere else, by construction.
 *
 * "At generation" means the generation of the app that CONSUMES the group, and it can only rank
 * members it can see. A member registered by a composed package is visible only when that package's
 * manifest was read as supply — which `generateManifest` does in app mode, and passes to the
 * lifetime check for exactly this reason. A run that ranks a group root without composed supply
 * (a stale generated manifest, or a composing app generated by a version predating that wiring)
 * ranks the local members and no others. The guarantee is "checked wherever the members were
 * visible at generation", not "checked, unconditionally": if this file's registrations came from
 * such a run, a composed member's lifetime was never ranked by anything, here or there.
 */
export const registerIocFromManifest = <TCradle extends object>(
  container: AwilixContainer<TCradle>,
  manifests: readonly IocRegisterableManifest[],
  overrides?: ComposedRegistrationOverrides,
  options?: IocRuntimeOptions,
): void => {
  /* Before any registration, so strict also governs the registrations below (Awilix refuses a
     singleton registered on a scoped container under strict) and not just later resolves. Awilix
     copies the options object it was constructed with, so this writes to the container's own copy
     — the caller's `createContainer` argument is untouched, and sibling containers are unaffected. */
  container.options.strict = options?.strict ?? true;

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
    groupedContractNamesFromManifest(groupsManifest),
  );
  registerGroups(container, groupsManifest, keyIndex);
  registerScopeRootOpeners(
    container,
    manifest.scopeRoots,
    moduleImports,
    keyIndex,
  );
};
