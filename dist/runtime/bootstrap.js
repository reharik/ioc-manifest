import { aliasTo, asFunction, Lifetime, } from "awilix";
import { contractNameToCollectionRegistrationKey, contractNameToDefaultRegistrationKey, } from "../generator/naming.js";
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
const invokeResolvedFactory = (factory, cradle) => {
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
    return factory(cradle);
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
        throw new Error(`[ioc] contract ${JSON.stringify(contractName)}: could not determine default implementation (expected exactly one implementation or one row with default: true).`);
    }
    return defaultImpl;
};
const registerImplementationFactories = (container, manifestByContract, moduleImports) => {
    for (const impls of Object.values(manifestByContract)) {
        for (const meta of Object.values(impls)) {
            const ns = moduleImports[meta.moduleIndex];
            if (!ns) {
                throw new Error(`[ioc] iocModuleImports[${meta.moduleIndex}] is missing (modulePath ${meta.modulePath})`);
            }
            const factory = ns[meta.exportName];
            if (typeof factory !== "function") {
                throw new Error(`[ioc] "${meta.modulePath}" has no function export ${JSON.stringify(meta.exportName)} for ${meta.contractName}`);
            }
            registerPair(container, {
                [meta.registrationKey]: asFunction((cradle) => invokeResolvedFactory(factory, cradle), { lifetime: lifetimeToAwilix(meta.lifetime) }),
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
    registerPair(container, {
        iocBundles: asFunction((cradle) => {
            return resolveBundleNodeFromCradle(cradle, bundlesManifest);
        }),
    });
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