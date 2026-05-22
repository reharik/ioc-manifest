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
import { parseDiscoveryScanDirs } from "./parseDiscoveryScanDirs.js";
import {
  findPackageIdentifierCollisions,
  formatPackageIdentifierCollisionError,
} from "./packageIdentifier.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const TOP_LEVEL_KEYS = new Set([
  "discovery",
  "composedManifests",
  "manifestExportPath",
  "packageName",
  "registrations",
  "groups",
]);

const DISCOVERY_KEYS = new Set([
  "scanDirs",
  "includes",
  "excludes",
  "factoryPrefix",
  "generatedDir",
]);

const IMPL_OVERRIDE_KEYS = new Set(["name", "lifetime", "default", "source"]);

const assertOnlyKeys = (
  record: Record<string, unknown>,
  allowed: Set<string>,
  pathLabel: string,
): void => {
  for (const k of Object.keys(record)) {
    if (!allowed.has(k)) {
      throw new Error(
        `[ioc-config] ${pathLabel} has unknown property ${JSON.stringify(k)}`,
      );
    }
  }
};

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

const readPackageJsonName = async (
  projectRoot: string,
): Promise<string | undefined> => {
  const pkgPath = path.join(projectRoot, "package.json");
  try {
    const text = await fs.readFile(pkgPath, "utf8");
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) {
      return undefined;
    }
    const name = parsed.name;
    return typeof name === "string" && name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
};

const resolveLocalPackageName = async (
  raw: Record<string, unknown>,
  projectRoot: string,
): Promise<string | undefined> => {
  const fromPackageJson = await readPackageJsonName(projectRoot);
  if (fromPackageJson !== undefined) {
    return fromPackageJson;
  }
  const fromConfig = raw.packageName;
  if (typeof fromConfig === "string" && fromConfig.length > 0) {
    return fromConfig;
  }
  return undefined;
};

const validateComposedManifestsField = (
  value: unknown,
  sourceLabel: string,
): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  validateStringArray(value, `${sourceLabel} composedManifests`);
  const list = value;
  if (list.length === 0) {
    console.warn(
      `[ioc-config] ${sourceLabel} composedManifests is an empty array; omit the field for library mode.`,
    );
    return list;
  }
  const seen = new Set<string>();
  for (const pkg of list) {
    if (seen.has(pkg)) {
      throw new Error(
        `[ioc-config] ${sourceLabel} composedManifests contains duplicate entry ${JSON.stringify(pkg)}`,
      );
    }
    seen.add(pkg);
  }
  return list;
};

const validateAppLibraryModeExclusivity = (
  raw: Record<string, unknown>,
  sourceLabel: string,
  composedManifests: string[] | undefined,
): void => {
  const inAppMode =
    composedManifests !== undefined && composedManifests.length > 0;
  if (inAppMode && raw.manifestExportPath !== undefined) {
    throw new Error(
      `[ioc-config] ${sourceLabel} manifestExportPath is only valid in library mode; remove it or remove composedManifests for app mode`,
    );
  }
};

const validateComposedManifestsSelfReference = (
  composedManifests: readonly string[],
  localPackageName: string | undefined,
  sourceLabel: string,
): void => {
  if (localPackageName === undefined) {
    throw new Error(
      `[ioc-config] ${sourceLabel} Unable to determine local package name for self-reference detection. Add packageName to your ioc.config.`,
    );
  }
  for (const pkg of composedManifests) {
    if (pkg === localPackageName) {
      throw new Error(
        `[ioc-config] ${sourceLabel} composedManifests cannot include this package's own name ${JSON.stringify(pkg)} (self-composition is not supported)`,
      );
    }
  }
};

const validateRegistrationsSourceOverrides = (
  registrations: Record<string, unknown> | undefined,
  sourceLabel: string,
  composedManifests: readonly string[] | undefined,
  inAppMode: boolean,
): void => {
  if (registrations === undefined) {
    return;
  }

  const composedSet =
    composedManifests !== undefined
      ? new Set(composedManifests)
      : new Set<string>();

  for (const [contractName, perImplementation] of Object.entries(
    registrations,
  )) {
    if (!isRecord(perImplementation)) {
      continue;
    }
    for (const [implementationName, override] of Object.entries(
      perImplementation,
    )) {
      if (implementationName === IOC_CONTRACT_CONFIG_KEY) {
        continue;
      }
      if (!isRecord(override) || !("source" in override)) {
        continue;
      }

      const path = `${sourceLabel} registrations[${JSON.stringify(contractName)}][${JSON.stringify(implementationName)}].source`;

      if (!inAppMode) {
        throw new Error(
          `[ioc-config] ${path} is only valid when composedManifests is set (app mode)`,
        );
      }

      const source = override.source;
      if (typeof source !== "string" || source.length === 0) {
        throw new Error(
          `[ioc-config] ${path} must be "local" or a package name listed in composedManifests when set`,
        );
      }

      if (source === "local") {
        continue;
      }

      if (!composedSet.has(source)) {
        throw new Error(
          `[ioc-config] ${path} references ${JSON.stringify(source)}, which is not listed in composedManifests`,
        );
      }
    }
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

      assertOnlyKeys(
        override,
        IMPL_OVERRIDE_KEYS,
        `${sourceLabel} registrations["${contractName}"]["${implementationName}"]`,
      );

      if (override.name !== undefined) {
        if (typeof override.name !== "string" || override.name.length === 0) {
          throw new Error(
            `[ioc-config] ${sourceLabel} registrations["${contractName}"]["${implementationName}"].name must be a non-empty string when set`,
          );
        }
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

      if (override.source !== undefined) {
        if (typeof override.source !== "string" || override.source.length === 0) {
          throw new Error(
            `[ioc-config] ${sourceLabel} registrations["${contractName}"]["${implementationName}"].source must be a non-empty string when set`,
          );
        }
      }
    }
  }
};

const validateIocConfig = async (
  raw: unknown,
  sourceLabel: string,
): Promise<IocConfig> => {
  if (!isRecord(raw)) {
    throw new Error(`[ioc-config] ${sourceLabel} must export an object`);
  }

  assertOnlyKeys(raw, TOP_LEVEL_KEYS, sourceLabel);

  validateOptionalNonEmptyString(
    raw.packageName,
    `${sourceLabel} packageName`,
  );
  validateOptionalNonEmptyString(
    raw.manifestExportPath,
    `${sourceLabel} manifestExportPath`,
  );

  const composedManifests = validateComposedManifestsField(
    raw.composedManifests,
    sourceLabel,
  );
  validateAppLibraryModeExclusivity(raw, sourceLabel, composedManifests);

  const discovery = raw.discovery;
  if (!isRecord(discovery)) {
    throw new Error(`[ioc-config] ${sourceLabel} is missing discovery`);
  }

  if ("workspacePackageImportBases" in discovery) {
    throw new Error(
      `[ioc-config] ${sourceLabel} discovery.workspacePackageImportBases was removed in v2; use composedManifests instead.`,
    );
  }

  assertOnlyKeys(discovery, DISCOVERY_KEYS, `${sourceLabel} discovery`);

  parseDiscoveryScanDirs(
    discovery.scanDirs,
    `${sourceLabel} discovery.scanDirs`,
  );

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

  const inAppMode =
    composedManifests !== undefined && composedManifests.length > 0;
  validateRegistrationsSourceOverrides(
    isRecord(raw.registrations) ? raw.registrations : undefined,
    sourceLabel,
    composedManifests,
    inAppMode,
  );

  if (raw.groups !== undefined) {
    validateGroupsShape(raw.groups, `${sourceLabel} groups`);
  }

  const config = raw as IocConfig;

  if (composedManifests !== undefined && composedManifests.length > 0) {
    const projectRoot = resolveProjectRootFromIocConfigPath(sourceLabel);
    const localPackageName = await resolveLocalPackageName(raw, projectRoot);
    validateComposedManifestsSelfReference(
      composedManifests,
      localPackageName,
      sourceLabel,
    );

    const collisions = findPackageIdentifierCollisions(composedManifests);
    if (collisions.length > 0) {
      throw new Error(
        formatPackageIdentifierCollisionError(sourceLabel, collisions[0]!),
      );
    }
  }

  return config;
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
 * directory, the package root is the parent of that `src` (so `discovery.scanDirs` entries stay relative
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
