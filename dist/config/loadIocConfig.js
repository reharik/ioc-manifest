import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isBundleReferenceShape = (value) => {
    if (!isRecord(value)) {
        return false;
    }
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "$bundleRef") {
        return false;
    }
    return typeof value.$bundleRef === "string" && value.$bundleRef.length > 0;
};
const validateBundlesShape = (value, pathLabel) => {
    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            if (typeof item === "string" && item.length > 0) {
                return;
            }
            if (isBundleReferenceShape(item)) {
                return;
            }
            throw new Error(`[ioc-config] ${pathLabel}[${index}] must be a non-empty string or { $bundleRef: string }`);
        });
        return;
    }
    if (!isRecord(value)) {
        throw new Error(`[ioc-config] ${pathLabel} must be an object or an array of bundle items`);
    }
    for (const [key, child] of Object.entries(value)) {
        validateBundlesShape(child, `${pathLabel}.${key}`);
    }
};
const IOC_LIFETIMES = new Set(["singleton", "scoped", "transient"]);
const isIocLifetime = (value) => typeof value === "string" && IOC_LIFETIMES.has(value);
const validateIocConfig = (raw, sourceLabel) => {
    if (!isRecord(raw)) {
        throw new Error(`[ioc-config] ${sourceLabel} must export an object`);
    }
    const discovery = raw.discovery;
    if (!isRecord(discovery)) {
        throw new Error(`[ioc-config] ${sourceLabel} is missing discovery`);
    }
    const rootDir = discovery.rootDir;
    if (typeof rootDir !== "string" || rootDir.length === 0) {
        throw new Error(`[ioc-config] ${sourceLabel} discovery.rootDir must be a non-empty string`);
    }
    const includes = discovery.includes;
    if (includes !== undefined) {
        if (!Array.isArray(includes) || !includes.every((x) => typeof x === "string")) {
            throw new Error(`[ioc-config] ${sourceLabel} discovery.includes must be string[] when set`);
        }
    }
    const excludes = discovery.excludes;
    if (excludes !== undefined) {
        if (!Array.isArray(excludes) || !excludes.every((x) => typeof x === "string")) {
            throw new Error(`[ioc-config] ${sourceLabel} discovery.excludes must be string[] when set`);
        }
    }
    const factoryPrefix = discovery.factoryPrefix;
    if (factoryPrefix !== undefined &&
        (typeof factoryPrefix !== "string" || factoryPrefix.length === 0)) {
        throw new Error(`[ioc-config] ${sourceLabel} discovery.factoryPrefix must be a non-empty string when set`);
    }
    const generatedDir = discovery.generatedDir;
    if (generatedDir !== undefined &&
        (typeof generatedDir !== "string" || generatedDir.length === 0)) {
        throw new Error(`[ioc-config] ${sourceLabel} discovery.generatedDir must be a non-empty string when set`);
    }
    const registrations = raw.registrations;
    if (registrations !== undefined) {
        if (!isRecord(registrations)) {
            throw new Error(`[ioc-config] ${sourceLabel} registrations must be an object`);
        }
        for (const [contract, perImpl] of Object.entries(registrations)) {
            if (!isRecord(perImpl)) {
                throw new Error(`[ioc-config] ${sourceLabel} registrations["${contract}"] must be an object`);
            }
            for (const [implName, override] of Object.entries(perImpl)) {
                if (!isRecord(override)) {
                    throw new Error(`[ioc-config] ${sourceLabel} registrations["${contract}"]["${implName}"] must be an object`);
                }
                if (override.name !== undefined && typeof override.name !== "string") {
                    throw new Error(`[ioc-config] ${sourceLabel} registrations["${contract}"]["${implName}"].name must be a string when set`);
                }
                if (override.lifetime !== undefined && !isIocLifetime(override.lifetime)) {
                    throw new Error(`[ioc-config] ${sourceLabel} registrations["${contract}"]["${implName}"].lifetime must be singleton | scoped | transient when set`);
                }
                if (override.default !== undefined &&
                    typeof override.default !== "boolean") {
                    throw new Error(`[ioc-config] ${sourceLabel} registrations["${contract}"]["${implName}"].default must be a boolean when set`);
                }
            }
        }
    }
    const bundles = raw.bundles;
    if (bundles !== undefined) {
        if (!isRecord(bundles)) {
            throw new Error(`[ioc-config] ${sourceLabel} bundles must be an object`);
        }
        validateBundlesShape(bundles, `${sourceLabel} bundles`);
    }
    return raw;
};
export const loadIocConfig = async (absoluteConfigPath) => {
    const url = pathToFileURL(absoluteConfigPath).href;
    const mod = await import(url);
    const raw = mod.default ?? mod.iocConfig ?? mod.config;
    return validateIocConfig(raw, absoluteConfigPath);
};
export const resolveIocConfigPath = (projectRoot, explicitPath) => {
    if (explicitPath !== undefined && explicitPath.length > 0) {
        return path.isAbsolute(explicitPath)
            ? explicitPath
            : path.resolve(projectRoot, explicitPath);
    }
    const fromEnv = process.env.IOC_CONFIG;
    if (typeof fromEnv === "string" && fromEnv.length > 0) {
        return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(projectRoot, fromEnv);
    }
    return path.join(projectRoot, "src", "ioc.config.ts");
};
export const tryLoadIocConfig = async (absoluteConfigPath) => {
    try {
        await fs.access(absoluteConfigPath);
    }
    catch {
        return undefined;
    }
    return loadIocConfig(absoluteConfigPath);
};
//# sourceMappingURL=loadIocConfig.js.map