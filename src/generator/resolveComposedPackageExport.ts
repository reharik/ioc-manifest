/**
 * @fileoverview Resolves installed workspace packages and their `package.json` export subpaths
 * for composed-manifest loading (codegen and `ioc validate`).
 */
import fs from "node:fs";
import path from "node:path";

export type ConditionalPackageExportsEntry = {
  readonly [condition: string]: string | undefined;
};

export type PackageExportsEntry = string | ConditionalPackageExportsEntry;

export type ResolvePackageExportOptions = {
  readonly customConditions?: readonly string[];
};

const VALUE_LOAD_FALLBACK_CONDITIONS = ["import", "default"] as const;

export const buildValueLoadConditionOrder = (
  customConditions?: readonly string[],
): readonly string[] => {
  const order: string[] = [];
  if (customConditions !== undefined && customConditions.length > 0) {
    order.push(...customConditions);
  }
  for (const condition of VALUE_LOAD_FALLBACK_CONDITIONS) {
    order.push(condition);
  }
  return order;
};

const listLoadableExportConditions = (
  entry: ConditionalPackageExportsEntry,
): readonly string[] =>
  Object.keys(entry).filter(
    (condition) =>
      condition !== "types" && typeof entry[condition] === "string",
  );

export const pickExportRelativePath = (
  entry: PackageExportsEntry,
  exportSubpath: string,
  packageName: string,
  customConditions?: readonly string[],
): { readonly rel: string; readonly condition: string } => {
  if (typeof entry === "string") {
    return { rel: entry, condition: "default" };
  }

  const order = buildValueLoadConditionOrder(customConditions);
  for (const condition of order) {
    const rel = entry[condition];
    if (typeof rel === "string" && rel.length > 0) {
      return { rel, condition };
    }
  }

  const available = listLoadableExportConditions(entry);
  if (available.length === 0) {
    const declared = Object.keys(entry).filter(
      (condition) => typeof entry[condition] === "string",
    );
    if (declared.length > 0 && declared.every((condition) => condition === "types")) {
      throw new Error(
        `[ioc] Cannot resolve subpath export ${JSON.stringify(exportSubpath)} for ${JSON.stringify(packageName)}: export only declares ${JSON.stringify(declared)} (${JSON.stringify(entry.types)}). Add a source-pointing condition such as "development" or "default" for manifest loading.`,
      );
    }
  }

  if (customConditions !== undefined && customConditions.length > 0) {
    throw new Error(
      `[ioc] Cannot resolve subpath export ${JSON.stringify(exportSubpath)} for ${JSON.stringify(packageName)}.\n` +
        `None of the configured customConditions matched: ${JSON.stringify([...customConditions])}\n` +
        `Available conditions in this export: ${JSON.stringify([...available])}`,
    );
  }

  throw new Error(
    `[ioc-config] ${JSON.stringify(packageName)} must export ${JSON.stringify(exportSubpath)} in package.json (see design doc §6.1)`,
  );
};

export const findPackageDirectory = (
  projectRoot: string,
  packageName: string,
): string => {
  const candidates: string[] = [];
  let dir = path.resolve(projectRoot);
  for (let i = 0; i < 8; i++) {
    candidates.push(path.join(dir, "node_modules", packageName));
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  for (const candidate of candidates) {
    const pkgJson = path.join(candidate, "package.json");
    if (fs.existsSync(pkgJson)) {
      return candidate;
    }
  }

  throw new Error(
    `[ioc-config] cannot locate installed package ${JSON.stringify(packageName)} from project root ${JSON.stringify(projectRoot)}`,
  );
};

export const readPackageJsonName = (
  packageDir: string,
  fallback: string,
): string => {
  const pkgJsonPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    return fallback;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
    name?: unknown;
  };
  return typeof pkg.name === "string" && pkg.name.length > 0 ? pkg.name : fallback;
};

/**
 * Resolves an export subpath (e.g. `./iocManifest`, `./iocTypes`) to an absolute file path.
 */
export const resolvePackageExportPath = (
  projectRoot: string,
  packageName: string,
  exportSubpath: string,
  options?: ResolvePackageExportOptions,
): string => {
  const pkgDir = findPackageDirectory(projectRoot, packageName);
  const pkgJsonPath = path.join(pkgDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
    exports?: Record<string, PackageExportsEntry>;
  };
  const entry = pkg.exports?.[exportSubpath];
  if (entry === undefined) {
    throw new Error(
      `[ioc-config] ${JSON.stringify(packageName)} must export ${JSON.stringify(exportSubpath)} in package.json (see design doc §6.1)`,
    );
  }

  const { rel, condition } = pickExportRelativePath(
    entry,
    exportSubpath,
    packageName,
    options?.customConditions,
  );
  const resolved = path.join(pkgDir, rel);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `[ioc] Resolved subpath export for ${JSON.stringify(`${packageName}${exportSubpath}`)} to ${JSON.stringify(rel)} (condition: ${JSON.stringify(condition)}), but the file does not exist.\n` +
        `This usually means "ioc generate" has not been run for that package yet, or its generatedDir is misconfigured.`,
    );
  }
  return resolved;
};
