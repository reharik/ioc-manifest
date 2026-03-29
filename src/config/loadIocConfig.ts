import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { IocConfig, IocLifetime } from "./iocConfig.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const GROUP_KINDS = new Set(["collection", "object"]);

const validateGroupsShape = (value: unknown, pathLabel: string): void => {
  if (!isRecord(value)) {
    throw new Error(`[ioc-config] ${pathLabel} must be an object`);
  }
  for (const [name, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      throw new Error(
        `[ioc-config] ${pathLabel}.${JSON.stringify(name)} must be an object`,
      );
    }
    const kind = entry.kind;
    if (typeof kind !== "string" || !GROUP_KINDS.has(kind)) {
      throw new Error(
        `[ioc-config] ${pathLabel}.${JSON.stringify(name)}.kind must be "collection" or "object"`,
      );
    }
    const baseType = entry.baseType;
    if (typeof baseType !== "string" || baseType.length === 0) {
      throw new Error(
        `[ioc-config] ${pathLabel}.${JSON.stringify(name)}.baseType must be a non-empty string`,
      );
    }
    const allowed = new Set(["kind", "baseType"]);
    for (const k of Object.keys(entry)) {
      if (!allowed.has(k)) {
        throw new Error(
          `[ioc-config] ${pathLabel}.${JSON.stringify(name)} has unknown property ${JSON.stringify(k)} (only kind and baseType are allowed)`,
        );
      }
    }
  }
};

const IOC_LIFETIMES = new Set(["singleton", "scoped", "transient"]);

const isIocLifetime = (value: unknown): value is IocLifetime =>
  typeof value === "string" && IOC_LIFETIMES.has(value);

const validateIocConfig = (raw: unknown, sourceLabel: string): IocConfig => {
  if (!isRecord(raw)) {
    throw new Error(`[ioc-config] ${sourceLabel} must export an object`);
  }
  const discovery = raw.discovery;
  if (!isRecord(discovery)) {
    throw new Error(`[ioc-config] ${sourceLabel} is missing discovery`);
  }
  const rootDir = discovery.rootDir;
  if (typeof rootDir !== "string" || rootDir.length === 0) {
    throw new Error(
      `[ioc-config] ${sourceLabel} discovery.rootDir must be a non-empty string`,
    );
  }

  const includes = discovery.includes;
  if (includes !== undefined) {
    if (!Array.isArray(includes) || !includes.every((x) => typeof x === "string")) {
      throw new Error(
        `[ioc-config] ${sourceLabel} discovery.includes must be string[] when set`,
      );
    }
  }

  const excludes = discovery.excludes;
  if (excludes !== undefined) {
    if (!Array.isArray(excludes) || !excludes.every((x) => typeof x === "string")) {
      throw new Error(
        `[ioc-config] ${sourceLabel} discovery.excludes must be string[] when set`,
      );
    }
  }

  const factoryPrefix = discovery.factoryPrefix;
  if (
    factoryPrefix !== undefined &&
    (typeof factoryPrefix !== "string" || factoryPrefix.length === 0)
  ) {
    throw new Error(
      `[ioc-config] ${sourceLabel} discovery.factoryPrefix must be a non-empty string when set`,
    );
  }

  const generatedDir = discovery.generatedDir;
  if (
    generatedDir !== undefined &&
    (typeof generatedDir !== "string" || generatedDir.length === 0)
  ) {
    throw new Error(
      `[ioc-config] ${sourceLabel} discovery.generatedDir must be a non-empty string when set`,
    );
  }

  const registrations = raw.registrations;
  if (registrations !== undefined) {
    if (!isRecord(registrations)) {
      throw new Error(`[ioc-config] ${sourceLabel} registrations must be an object`);
    }
    for (const [contract, perImpl] of Object.entries(registrations)) {
      if (!isRecord(perImpl)) {
        throw new Error(
          `[ioc-config] ${sourceLabel} registrations["${contract}"] must be an object`,
        );
      }
      for (const [implName, override] of Object.entries(perImpl)) {
        if (!isRecord(override)) {
          throw new Error(
            `[ioc-config] ${sourceLabel} registrations["${contract}"]["${implName}"] must be an object`,
          );
        }
        if (override.name !== undefined && typeof override.name !== "string") {
          throw new Error(
            `[ioc-config] ${sourceLabel} registrations["${contract}"]["${implName}"].name must be a string when set`,
          );
        }
        if (override.lifetime !== undefined && !isIocLifetime(override.lifetime)) {
          throw new Error(
            `[ioc-config] ${sourceLabel} registrations["${contract}"]["${implName}"].lifetime must be singleton | scoped | transient when set`,
          );
        }
        if (
          override.default !== undefined &&
          typeof override.default !== "boolean"
        ) {
          throw new Error(
            `[ioc-config] ${sourceLabel} registrations["${contract}"]["${implName}"].default must be a boolean when set`,
          );
        }
      }
    }
  }

  const groups = raw.groups;
  if (groups !== undefined) {
    validateGroupsShape(groups, `${sourceLabel} groups`);
  }

  return raw as IocConfig;
};

export const loadIocConfig = async (
  absoluteConfigPath: string,
): Promise<IocConfig> => {
  const url = pathToFileURL(absoluteConfigPath).href;
  const mod = await import(url);
  const raw = mod.default ?? mod.iocConfig ?? mod.config;
  return validateIocConfig(raw, absoluteConfigPath);
};

export const resolveIocConfigPath = (
  projectRoot: string,
  explicitPath?: string,
): string => {
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

export const tryLoadIocConfig = async (
  absoluteConfigPath: string,
): Promise<IocConfig | undefined> => {
  try {
    await fs.access(absoluteConfigPath);
  } catch {
    return undefined;
  }
  return loadIocConfig(absoluteConfigPath);
};
