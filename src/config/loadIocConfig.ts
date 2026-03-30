/**
 * @fileoverview Loads and validates `ioc.config.ts` (or `--config` / `IOC_CONFIG` overrides).
 * Fail-fast validation with `[ioc-config]` errors. The loaded module’s default export (or
 * `iocConfig` / `config`) supplies the raw shape validated into {@link IocConfig}.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fg from "fast-glob";
import {
  IOC_CONTRACT_CONFIG_KEY,
  parseContractLevelConfig,
  type IocConfig,
  type IocLifetime,
} from "./iocConfig.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const GROUP_KINDS = new Set(["collection", "object"]);
const IOC_LIFETIMES = new Set(["singleton", "scoped", "transient"]);

const isIocLifetime = (value: unknown): value is IocLifetime =>
  typeof value === "string" && IOC_LIFETIMES.has(value);

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
    for (const key of Object.keys(entry)) {
      if (!allowed.has(key)) {
        throw new Error(
          `[ioc-config] ${pathLabel}.${JSON.stringify(name)} has unknown property ${JSON.stringify(key)} (only kind and baseType are allowed)`,
        );
      }
    }
  }
};

const validateStringArray: (
  value: unknown,
  pathLabel: string,
) => asserts value is string[] = (value, pathLabel) => {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(`[ioc-config] ${pathLabel} must be string[] when set`);
  }
};

const validateOptionalNonEmptyString = (
  value: unknown,
  pathLabel: string,
): void => {
  if (
    value !== undefined &&
    (typeof value !== "string" || value.length === 0)
  ) {
    throw new Error(
      `[ioc-config] ${pathLabel} must be a non-empty string when set`,
    );
  }
};

const validateRegistrationsShape = (
  registrations: unknown,
  sourceLabel: string,
): void => {
  if (registrations === undefined) {
    return;
  }

  if (!isRecord(registrations)) {
    throw new Error(
      `[ioc-config] ${sourceLabel} registrations must be an object`,
    );
  }

  for (const [contractName, perImplementation] of Object.entries(
    registrations,
  )) {
    if (!isRecord(perImplementation)) {
      throw new Error(
        `[ioc-config] ${sourceLabel} registrations["${contractName}"] must be an object`,
      );
    }

    for (const [implementationName, override] of Object.entries(
      perImplementation,
    )) {
      if (!isRecord(override)) {
        throw new Error(
          `[ioc-config] ${sourceLabel} registrations["${contractName}"]["${implementationName}"] must be an object`,
        );
      }

      if (implementationName === IOC_CONTRACT_CONFIG_KEY) {
        parseContractLevelConfig(
          override,
          `${sourceLabel} registrations["${contractName}"]["${implementationName}"]`,
        );
        continue;
      }

      if (override.name !== undefined && typeof override.name !== "string") {
        throw new Error(
          `[ioc-config] ${sourceLabel} registrations["${contractName}"]["${implementationName}"].name must be a string when set`,
        );
      }

      if (
        override.lifetime !== undefined &&
        !isIocLifetime(override.lifetime)
      ) {
        throw new Error(
          `[ioc-config] ${sourceLabel} registrations["${contractName}"]["${implementationName}"].lifetime must be singleton | scoped | transient when set`,
        );
      }

      if (
        override.default !== undefined &&
        typeof override.default !== "boolean"
      ) {
        throw new Error(
          `[ioc-config] ${sourceLabel} registrations["${contractName}"]["${implementationName}"].default must be a boolean when set`,
        );
      }
    }
  }
};

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

  if (discovery.includes !== undefined) {
    validateStringArray(
      discovery.includes,
      `${sourceLabel} discovery.includes`,
    );
  }

  if (discovery.excludes !== undefined) {
    validateStringArray(
      discovery.excludes,
      `${sourceLabel} discovery.excludes`,
    );
  }

  validateOptionalNonEmptyString(
    discovery.factoryPrefix,
    `${sourceLabel} discovery.factoryPrefix`,
  );
  validateOptionalNonEmptyString(
    discovery.generatedDir,
    `${sourceLabel} discovery.generatedDir`,
  );

  validateRegistrationsShape(raw.registrations, sourceLabel);

  if (raw.groups !== undefined) {
    validateGroupsShape(raw.groups, `${sourceLabel} groups`);
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

const CONFIG_RELATIVE_SEARCH_PATHS = ["src/ioc.config.ts", "ioc.config.ts"] as const;

/**
 * IoC package root inferred from where `ioc.config` lives: if the config file is under a `src`
 * directory, the package root is the parent of that `src` (so `discovery.rootDir` stays relative
 * to the package, not `process.cwd()`). Otherwise the package root is the config file directory.
 */
export const resolveProjectRootFromIocConfigPath = (
  absoluteConfigPath: string,
): string => {
  const configDir = path.dirname(absoluteConfigPath);
  return path.basename(configDir) === "src"
    ? path.dirname(configDir)
    : configDir;
};

/**
 * Resolves the absolute path to `ioc.config.ts`.
 *
 * - When `explicitPath` or `IOC_CONFIG` is set, resolves relative to `searchStartDir` if not absolute.
 * - Otherwise walks upward from `searchStartDir` for `src/ioc.config.ts` / `ioc.config.ts`.
 * - If none is found upward, searches downward for the shallowest nested `src/ioc.config.ts`
 *   (glob, excluding `node_modules` and similar). If several are found, throws with a prompt to use
 *   `--project` / `--config`.
 * - If still none, returns `searchStartDir/src/ioc.config.ts` (legacy default) for missing-file handling.
 */
export const resolveIocConfigPath = (
  searchStartDir: string,
  explicitPath?: string,
): string => {
  const start = path.resolve(searchStartDir);

  if (explicitPath !== undefined && explicitPath.length > 0) {
    return path.isAbsolute(explicitPath)
      ? explicitPath
      : path.resolve(start, explicitPath);
  }

  const fromEnv = process.env.IOC_CONFIG;
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return path.isAbsolute(fromEnv)
      ? fromEnv
      : path.resolve(start, fromEnv);
  }

  let dir = start;
  const root = path.parse(dir).root;
  while (true) {
    for (const rel of CONFIG_RELATIVE_SEARCH_PATHS) {
      const candidate = path.join(dir, rel);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    if (dir === root) {
      break;
    }
    dir = path.dirname(dir);
  }

  const downward = fg.sync("**/src/ioc.config.ts", {
    cwd: start,
    absolute: true,
    onlyFiles: true,
    unique: true,
    deep: 15,
    ignore: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.git/**",
    ],
  });
  const byPathDepth = (a: string, b: string): number =>
    a.split(path.sep).length - b.split(path.sep).length;
  const ranked = [...new Set(downward)].sort(byPathDepth);
  if (ranked.length === 1) {
    return ranked[0];
  }
  if (ranked.length > 1) {
    throw new Error(
      `[ioc-config] Multiple src/ioc.config.ts files found under ${start}. Pass --project <path> to the package directory or use --config.`,
    );
  }

  return path.join(start, "src", "ioc.config.ts");
};

/**
 * Returns `undefined` if the file is missing — used when generation should fall back to CLI defaults.
 * If the file exists, loads it and validates (same as {@link loadIocConfig}).
 */
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
