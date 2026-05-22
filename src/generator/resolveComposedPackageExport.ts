/**
 * @fileoverview Resolves installed workspace packages and their `package.json` export subpaths
 * for composed-manifest loading (codegen and `ioc validate`).
 */
import fs from "node:fs";
import path from "node:path";

export type PackageExportsEntry =
  | string
  | {
      readonly import?: string;
      readonly types?: string;
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
): string => {
  const pkgDir = findPackageDirectory(projectRoot, packageName);
  const pkgJsonPath = path.join(pkgDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
    exports?: Record<string, PackageExportsEntry>;
  };
  const entry = pkg.exports?.[exportSubpath];
  const rel =
    typeof entry === "string"
      ? entry
      : entry?.import ?? entry?.types;
  if (typeof rel !== "string") {
    throw new Error(
      `[ioc-config] ${JSON.stringify(packageName)} must export ${JSON.stringify(exportSubpath)} in package.json (see design doc §6.1)`,
    );
  }
  const resolved = path.join(pkgDir, rel);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `[ioc-config] ${JSON.stringify(packageName)} export ${JSON.stringify(exportSubpath)} points to missing file ${JSON.stringify(rel)} (run \`ioc generate\` in that package)`,
    );
  }
  return resolved;
};
