const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isBundleReference = (value) => {
    if (!isRecord(value)) {
        return false;
    }
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "$bundleRef") {
        return false;
    }
    return typeof value.$bundleRef === "string" && value.$bundleRef.length > 0;
};
const bundlePathToLabel = (segments) => {
    if (segments.length === 0) {
        return "bundles";
    }
    return `bundles.${segments.join(".")}`;
};
const validateRawArrayItems = (arrayPath, items) => {
    const out = [];
    items.forEach((item, index) => {
        if (typeof item === "string") {
            if (item.length === 0) {
                throw new Error(`[ioc-config] ${bundlePathToLabel(arrayPath)}[${index}] must be a non-empty contract name string or { $bundleRef: string }`);
            }
            out.push(item);
            return;
        }
        if (isBundleReference(item)) {
            out.push(item);
            return;
        }
        throw new Error(`[ioc-config] ${bundlePathToLabel(arrayPath)}[${index}] has invalid shape. Expected contract name string or { $bundleRef: string }`);
    });
    return out;
};
const collectBundleArrays = (node, pathSegments, arraysByPath) => {
    if (Array.isArray(node)) {
        const path = pathSegments.join(".");
        arraysByPath.set(path, validateRawArrayItems(pathSegments, node));
        return;
    }
    if (!isRecord(node)) {
        throw new Error(`[ioc-config] ${bundlePathToLabel(pathSegments)} has invalid node shape. Expected an object or an array of contract refs`);
    }
    for (const [key, value] of Object.entries(node)) {
        collectBundleArrays(value, [...pathSegments, key], arraysByPath);
    }
};
const assertReferencesAndContractsExist = (arraysByPath, contractsByName) => {
    for (const [arrayPath, items] of arraysByPath) {
        items.forEach((item, index) => {
            if (typeof item === "string") {
                if (!contractsByName.has(item)) {
                    throw new Error(`[ioc-config] bundles.${arrayPath}[${index}] references unknown contract ${JSON.stringify(item)}. Known contracts: ${Array.from(contractsByName.keys()).sort().join(", ")}`);
                }
                return;
            }
            if (!arraysByPath.has(item.$bundleRef)) {
                throw new Error(`[ioc-config] bundles.${arrayPath}[${index}] references unknown bundle path ${JSON.stringify(item.$bundleRef)}. Only array bundle nodes can be referenced.`);
            }
        });
    }
};
const collectArrayRefs = (items) => items
    .filter((item) => typeof item !== "string")
    .map((item) => item.$bundleRef);
const detectReferenceCycles = (arraysByPath) => {
    const visiting = new Set();
    const visited = new Set();
    const visit = (path, stack) => {
        if (visiting.has(path)) {
            const cycleStart = stack.indexOf(path);
            const cyclePath = [...stack.slice(cycleStart), path]
                .map((p) => `bundles.${p}`)
                .join(" -> ");
            throw new Error(`[ioc-config] bundles reference cycle detected: ${cyclePath}`);
        }
        if (visited.has(path)) {
            return;
        }
        visiting.add(path);
        const refs = collectArrayRefs(arraysByPath.get(path) ?? []);
        refs.forEach((refPath) => visit(refPath, [...stack, path]));
        visiting.delete(path);
        visited.add(path);
    };
    Array.from(arraysByPath.keys()).forEach((path) => {
        visit(path, []);
    });
};
const resolveBundleArray = (arrayPath, arraysByPath, contractsByName, cache) => {
    const cached = cache.get(arrayPath);
    if (cached !== undefined) {
        return cached;
    }
    const items = arraysByPath.get(arrayPath);
    if (items === undefined) {
        throw new Error(`[ioc-config] internal error: bundle array path ${JSON.stringify(arrayPath)} not found`);
    }
    const resolved = [];
    items.forEach((item) => {
        if (typeof item === "string") {
            const contract = contractsByName.get(item);
            if (contract === undefined) {
                throw new Error(`[ioc-config] internal error: contract ${JSON.stringify(item)} missing during bundle resolution`);
            }
            resolved.push({
                contractName: contract.contractName,
                registrationKey: contract.contractKey,
            });
            return;
        }
        resolved.push(...resolveBundleArray(item.$bundleRef, arraysByPath, contractsByName, cache));
    });
    cache.set(arrayPath, resolved);
    return resolved;
};
const resolveBundleTree = (node, pathSegments, arraysByPath, contractsByName, cache) => {
    if (Array.isArray(node)) {
        return resolveBundleArray(pathSegments.join("."), arraysByPath, contractsByName, cache);
    }
    if (!isRecord(node)) {
        throw new Error(`[ioc-config] internal error: expected object node at ${bundlePathToLabel(pathSegments)}`);
    }
    const out = {};
    for (const [key, value] of Object.entries(node)) {
        out[key] = resolveBundleTree(value, [...pathSegments, key], arraysByPath, contractsByName, cache);
    }
    return out;
};
export const buildBundlePlan = (bundles, plans) => {
    if (bundles === undefined) {
        return undefined;
    }
    if (!isRecord(bundles)) {
        throw new Error("[ioc-config] bundles must be an object when set");
    }
    const contractsByName = new Map(plans.map((plan) => [plan.contractName, plan]));
    const arraysByPath = new Map();
    collectBundleArrays(bundles, [], arraysByPath);
    assertReferencesAndContractsExist(arraysByPath, contractsByName);
    detectReferenceCycles(arraysByPath);
    const cache = new Map();
    const resolved = resolveBundleTree(bundles, [], arraysByPath, contractsByName, cache);
    if (Array.isArray(resolved)) {
        throw new Error("[ioc-config] bundles root must be an object");
    }
    return resolved;
};
//# sourceMappingURL=resolveBundlePlan.js.map