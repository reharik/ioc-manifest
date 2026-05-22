/**
 * @fileoverview Loads contract names from composed package manifests for app-mode validation.
 */
import { createRequire } from "node:module";
import path from "node:path";
import type { IocContractManifest } from "../core/manifest.js";

export type ComposedManifestContractNames = {
  readonly all: ReadonlySet<string>;
  readonly byPackage: ReadonlyMap<string, ReadonlySet<string>>;
};

const readContractsFromManifestModule = (
  resolvedPath: string,
): IocContractManifest => {
  const require = createRequire(resolvedPath);
  const mod = require(resolvedPath) as { iocManifest?: { contracts?: unknown } };
  const contracts = mod.iocManifest?.contracts;
  if (contracts === undefined || typeof contracts !== "object") {
    throw new Error(
      `[ioc-config] composed package manifest at ${JSON.stringify(resolvedPath)} does not export iocManifest.contracts`,
    );
  }
  return contracts as IocContractManifest;
};

/**
 * Resolves each package's `iocManifest` subpath and collects contract names declared in that manifest.
 */
export const loadComposedManifestContractNames = (
  projectRoot: string,
  composedPackageNames: readonly string[],
): ComposedManifestContractNames => {
  const require = createRequire(path.join(projectRoot, "package.json"));
  const byPackage = new Map<string, ReadonlySet<string>>();
  const all = new Set<string>();

  for (const packageName of composedPackageNames) {
    const resolved = require.resolve(`${packageName}/iocManifest`, {
      paths: [projectRoot],
    });
    const contracts = readContractsFromManifestModule(resolved);
    const names = new Set(Object.keys(contracts));
    byPackage.set(packageName, names);
    for (const name of names) {
      all.add(name);
    }
  }

  return { all, byPackage };
};
