import { aliasTo, asFunction, Lifetime, } from "awilix";
import { contractNameToCollectionRegistrationKey, contractNameToDefaultRegistrationKey, } from "../generator/naming.js";
import { formatMissingDefaultImplementationMessage, formatMissingFactoryExportMessage, formatMissingModuleImportMessage, } from "./iocRuntimeErrors.js";
const lifetimeToAwilix = (lifetime) => {
    switch (lifetime) {
        case "singleton":
            return Lifetime.SINGLETON;
        case "scoped":
            return Lifetime.SCOPED;
        case "transient":
            return Lifetime.TRANSIENT;
        default: {
            const _exhaustive = lifetime;
            return _exhaustive;
        }
    }
};
const registerPair = (container, pair) => {
    /* Registration keys come from generated manifests; Awilix types cannot express this map statically. */
    container.register(pair);
};
const isFactoryFunction = (value) => typeof value === "function";
const invokeResolvedFactory = (factory, cradle, meta) => {
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
    try {
        return factory(cradle);
    }
    catch (cause) {
        const depHint = meta.dependencyContractNames !== undefined &&
            meta.dependencyContractNames.length > 0
            ? ` Inferred dependency contracts from the factory parameter type: ${meta.dependencyContractNames.map((c) => JSON.stringify(c)).join(", ")}. Ensure each is registered in the container.`
            : "";
        const prefix = `[ioc] Factory ${JSON.stringify(meta.exportName)} (${meta.modulePath}) failed while building ${JSON.stringify(meta.contractName)} (implementation ${JSON.stringify(meta.implementationName)}).${depHint}`;
        if (cause instanceof Error && cause.message.length > 0) {
            throw new Error(`${prefix}\nCaused by: ${cause.message}`, { cause });
        }
        throw new Error(prefix, {
            cause: cause instanceof Error ? cause : undefined,
        });
    }
};
const collectionLifetimeFromImplementations = (impls) => {
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
const resolveDefaultImplementation = (contractName, implList) => {
    const defaultImpl = implList.find((m) => m.default === true) ??
        (implList.length === 1 ? implList[0] : undefined);
    if (!defaultImpl) {
        if (implList.length === 0) {
            throw new Error(`[ioc] Contract ${JSON.stringify(contractName)} has no implementations in the manifest. Add at least one factory and re-run manifest generation.`);
        }
        throw new Error(formatMissingDefaultImplementationMessage({
            contractName,
            implementationNames: implList.map((m) => m.implementationName),
            registrationKeys: implList.map((m) => m.registrationKey),
        }));
    }
    return defaultImpl;
};
const registerImplementationFactories = (container, manifestByContract, moduleImports) => {
    for (const impls of Object.values(manifestByContract)) {
        for (const meta of Object.values(impls)) {
            const ns = moduleImports[meta.moduleIndex];
            if (!ns) {
                throw new Error(formatMissingModuleImportMessage({
                    moduleIndex: meta.moduleIndex,
                    modulePath: meta.modulePath,
                }));
            }
            const factory = ns[meta.exportName];
            if (typeof factory !== "function") {
                throw new Error(formatMissingFactoryExportMessage({
                    modulePath: meta.modulePath,
                    exportName: meta.exportName,
                    contractName: meta.contractName,
                    registrationKey: meta.registrationKey,
                }));
            }
            registerPair(container, {
                [meta.registrationKey]: asFunction((cradle) => invokeResolvedFactory(factory, cradle, meta), { lifetime: lifetimeToAwilix(meta.lifetime) }),
            });
        }
    }
};
const registerContractDefaultAliases = (container, manifestByContract) => {
    for (const [contractName, impls] of Object.entries(manifestByContract)) {
        const contractKey = contractNameToDefaultRegistrationKey(contractName);
        const implList = Object.values(impls);
        const defaultImpl = resolveDefaultImplementation(contractName, implList);
        const hasImplementationAtContractKey = implList.some((meta) => meta.registrationKey === contractKey);
        if (contractKey !== defaultImpl.registrationKey &&
            !hasImplementationAtContractKey) {
            registerPair(container, {
                [contractKey]: aliasTo(defaultImpl.registrationKey),
            });
        }
    }
};
const registerImplementationCollections = (container, manifestByContract) => {
    for (const [contractName, impls] of Object.entries(manifestByContract)) {
        const implList = Object.values(impls);
        if (implList.length <= 1) {
            continue;
        }
        const collectionKey = contractNameToCollectionRegistrationKey(contractName);
        const collectionLifetime = collectionLifetimeFromImplementations(implList);
        registerPair(container, {
            [collectionKey]: asFunction((cradle) => {
                const map = {};
                for (const meta of implList) {
                    map[meta.implementationName] =
                        cradle[meta.registrationKey];
                }
                return map;
            }, { lifetime: collectionLifetime }),
        });
    }
};
const resolveBundleNodeFromCradle = (cradle, node) => {
    if (Array.isArray(node)) {
        return node.map((leaf) => cradle[leaf.registrationKey]);
    }
    const out = {};
    for (const [key, value] of Object.entries(node)) {
        out[key] = resolveBundleNodeFromCradle(cradle, value);
    }
    return out;
};
const registerBundles = (container, bundlesManifest) => {
    if (bundlesManifest === undefined) {
        return;
    }
    const rootKeys = Object.keys(bundlesManifest).sort((a, b) => a.localeCompare(b));
    for (const key of rootKeys) {
        const node = bundlesManifest[key];
        registerPair(container, {
            [key]: asFunction((cradle) => resolveBundleNodeFromCradle(cradle, node), { lifetime: Lifetime.TRANSIENT }),
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
export const registerIocFromManifest = (container, manifestByContract, moduleImports, bundlesManifest) => {
    registerImplementationFactories(container, manifestByContract, moduleImports);
    registerContractDefaultAliases(container, manifestByContract);
    registerImplementationCollections(container, manifestByContract);
    registerBundles(container, bundlesManifest);
};
//# sourceMappingURL=bootstrap.js.map