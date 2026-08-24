/**
 * @fileoverview Loads and validates `ioc.config.ts` (or `--config` / `IOC_CONFIG` overrides).
 * Fail-fast validation with `[ioc-config]` errors. The loaded module’s default export (or
 * `iocConfig` / `config`) supplies the raw shape validated into {@link IocConfig}.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { tsImport } from "tsx/esm/api";
import type { IocConfig } from "./iocConfig.js";
import { formatIocConfigIssues, iocConfigSchema } from "./iocConfigSchema.js";
import {
  findPackageIdentifierCollisions,
  formatPackageIdentifierCollisionError,
} from "./packageIdentifier.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const BUILTIN_TYPE_NAMES = new Set([
  "string",
  "number",
  "boolean",
  "symbol",
  "bigint",
  "undefined",
  "null",
  "object",
  "never",
  "unknown",
  "any",
  "void",
]);

/** Advisory warnings preserved from the previous hand validators (never throws). */
const warnIocConfigAdvisories = (config: IocConfig, sourceLabel: string): void => {
  if (config.composedManifests !== undefined && config.composedManifests.length === 0) {
    console.warn(
      `[ioc-config] ${sourceLabel} composedManifests is an empty array; omit the field for library mode.`,
    );
  }

  for (const markerName of Object.keys(config.lifetimeMarkers ?? {})) {
    if (BUILTIN_TYPE_NAMES.has(markerName)) {
      console.warn(
        `[ioc-config] warning: ${sourceLabel} lifetimeMarkers.${JSON.stringify(markerName)} uses a built-in type name ${JSON.stringify(markerName)}; prefer a dedicated marker interface`,
      );
    }
  }

  for (const [groupName, ids] of Object.entries(config.groupBaseTypeAliases ?? {})) {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) {
        console.warn(
          `[ioc-config] warning: ${sourceLabel} groupBaseTypeAliases.${JSON.stringify(groupName)} contains duplicate entry ${JSON.stringify(id)}`,
        );
      }
      seen.add(id);
    }
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

/**
 * Validates the raw config against {@link iocConfigSchema} (the single strict-schema artifact for
 * key sets, shapes, and I/O-free cross-field rules), then runs the checks that need the
 * filesystem: self-composition detection via the local package name, and composed-package
 * identifier collisions.
 */
const validateIocConfig = async (
  raw: unknown,
  sourceLabel: string,
): Promise<IocConfig> => {
  if (!isRecord(raw)) {
    throw new Error(`[ioc-config] ${sourceLabel} must export an object`);
  }

  const parsed = iocConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(formatIocConfigIssues(parsed.error, sourceLabel));
  }

  const config = raw as IocConfig;
  warnIocConfigAdvisories(config, sourceLabel);

  const composedManifests = config.composedManifests;
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

/**
 * Extracts the raw config from a loaded module namespace, tolerating both the ESM shape
 * (`{ default: config }` / `{ iocConfig: config }`) and the CJS-interop shape tsx emits for a
 * config whose package is not `type: module` (`{ default: { __esModule, default: config } }`).
 * A valid config never carries a `default` / `iocConfig` / `config` / `__esModule` key, so any
 * picked object still bearing one is an interop wrapper to descend through. Returns the first
 * non-wrapper value; a missing or non-object export falls through to {@link validateIocConfig}.
 */
const resolveConfigFromModule = (mod: Record<string, unknown>): unknown => {
  let current: Record<string, unknown> = mod;
  for (let depth = 0; depth < 4; depth++) {
    const picked = current.default ?? current.iocConfig ?? current.config;
    if (!isRecord(picked)) {
      return picked;
    }
    const isInteropWrapper =
      "__esModule" in picked ||
      "default" in picked ||
      "iocConfig" in picked ||
      "config" in picked;
    if (!isInteropWrapper) {
      return picked;
    }
    current = picked;
  }
  return current;
};

export const loadIocConfig = async (
  absoluteConfigPath: string,
): Promise<IocConfig> => {
  // Transpile the `.ts` config in-process via tsx's scoped loader rather than delegating to a
  // bare `import()`, which fails on Node versions without native type stripping. `tsImport`
  // patches the loader only for this import and restores it after, so the rest of the CLI is
  // untouched.
  const mod = (await tsImport(absoluteConfigPath, import.meta.url)) as Record<
    string,
    unknown
  >;
  const raw = resolveConfigFromModule(mod);
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
 * The `ioc.config` belonging to ONE package directory, without walking up.
 *
 * {@link resolveIocConfigPath} walks upward, which is right for a CLI invoked from somewhere inside
 * a package and wrong for asking a question ABOUT a named package: from
 * `packages/media-core` a walking search finds the monorepo root's config whenever that package has
 * none of its own, and answers a question about `media-core` with another package's scan set.
 *
 * Returns `undefined` when the directory holds no config — for a published package that ships its
 * manifest but not its sources, that is the ordinary answer and not an error.
 */
export const resolvePackageLocalIocConfigPath = (
  packageRoot: string,
): string | undefined => {
  for (const rel of CONFIG_RELATIVE_SEARCH_PATHS) {
    const candidate = path.join(packageRoot, rel);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
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
