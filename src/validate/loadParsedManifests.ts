/**
 * @fileoverview Loads local and composed manifests for `ioc validate` via AST parsing (no runtime import).
 */
import fs from "node:fs";
import path from "node:path";
import type { IocConfig } from "../config/iocConfig.js";
import { LOCAL_PACKAGE_IDENTIFIER } from "../config/packageIdentifier.js";
import { loadComposedManifestContractNames } from "../generator/loadComposedManifestContracts.js";
import { collectDeclaredGroupNamesForApp } from "../generator/loadComposedManifestGroups.js";
import {
  findPackageDirectory,
  readPackageJsonName,
  resolvePackageExportPath,
} from "../generator/resolveComposedPackageExport.js";
import {
  mergeManifestOptionsWithIocConfig,
  resolveManifestOptions,
} from "../generator/manifestOptions.js";
import { buildComposedRegistrationOverridesFromConfig } from "../generator/buildComposedRegistrationOverrides.js";
import {
  parseInterfacePropertyNames,
  parseIocManifestSource,
} from "./parseGeneratedSource.js";
import type { ParsedManifestSlice, ValidateContext } from "./types.js";

const readFileUtf8 = (filePath: string): string =>
  fs.readFileSync(filePath, "utf8");

const loadSliceFromPaths = (
  packageLabel: string,
  sourceId: string,
  manifestPath: string,
  typesPath: string,
): ParsedManifestSlice => {
  const manifestContent = readFileUtf8(manifestPath);
  const typesContent = readFileUtf8(typesPath);
  const parsed = parseIocManifestSource(manifestContent, manifestPath);
  const cradleProps = parseInterfacePropertyNames(
    typesContent,
    typesPath,
    "IocGeneratedCradle",
  );
  const externalProps = parseInterfacePropertyNames(
    typesContent,
    typesPath,
    "IocExternals",
  );

  const externals: Record<string, { typeText: string }> = {};
  for (const [key, typeText] of externalProps) {
    externals[key] = { typeText };
  }

  return {
    packageLabel,
    sourceId,
    manifestPath,
    typesPath,
    manifestSchemaVersion: parsed.manifestSchemaVersion,
    contracts: parsed.contracts,
    groupRoots: parsed.groupRoots,
    cradleKeys: new Set(cradleProps.keys()),
    externals,
  };
};

export type LoadValidateContextResult =
  | { readonly ok: true; readonly context: ValidateContext }
  | {
      readonly ok: false;
      readonly message: string;
      readonly detail?: string;
    };

export const loadValidateContext = async (
  projectRoot: string,
  configPath: string,
  config: IocConfig,
): Promise<LoadValidateContextResult> => {
  const composedPackageNames = config.composedManifests ?? [];
  const base = resolveManifestOptions({ paths: { projectRoot } });
  const options = mergeManifestOptionsWithIocConfig(base, config);

  const localLabel =
    typeof config.packageName === "string" && config.packageName.length > 0
      ? config.packageName
      : LOCAL_PACKAGE_IDENTIFIER;

  const localManifestPath = options.paths.manifestOutPath;
  const localTypesPath = path.join(
    options.paths.generatedDir,
    "ioc-registry.types.ts",
  );

  if (!fs.existsSync(localManifestPath)) {
    return {
      ok: false,
      message: `Local manifest not found at ${JSON.stringify(localManifestPath)}`,
      detail: "Run `ioc generate` in this package before `ioc validate`.",
    };
  }
  if (!fs.existsSync(localTypesPath)) {
    return {
      ok: false,
      message: `Local types file not found at ${JSON.stringify(localTypesPath)}`,
      detail: "Run `ioc generate` in this package before `ioc validate`.",
    };
  }

  const slices: ParsedManifestSlice[] = [
    loadSliceFromPaths(
      localLabel,
      LOCAL_PACKAGE_IDENTIFIER,
      localManifestPath,
      localTypesPath,
    ),
  ];

  for (const packageName of composedPackageNames) {
    try {
      const manifestPath = resolvePackageExportPath(
        projectRoot,
        packageName,
        "./iocManifest",
      );
      const typesPath = resolvePackageExportPath(
        projectRoot,
        packageName,
        "./iocTypes",
      );
      const pkgRoot = findPackageDirectory(projectRoot, packageName);
      const label = readPackageJsonName(pkgRoot, packageName);

      slices.push(
        loadSliceFromPaths(label, packageName, manifestPath, typesPath),
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message,
        detail: `Ensure ${JSON.stringify(packageName)} is installed, exports ./iocManifest and ./iocTypes, and has run \`ioc generate\`.`,
      };
    }
  }

  const composedContractNames = new Set<string>();
  try {
    const loaded = await loadComposedManifestContractNames(
      projectRoot,
      composedPackageNames,
    );
    for (const name of loaded.all) {
      composedContractNames.add(name);
    }
  } catch {
    for (const slice of slices.slice(1)) {
      for (const name of Object.keys(slice.contracts)) {
        composedContractNames.add(name);
      }
    }
  }

  const localContractNames = new Set(
    Object.keys(slices[0]!.contracts),
  );

  const declaredGroupNames = await collectDeclaredGroupNamesForApp(
    projectRoot,
    config,
  );

  return {
    ok: true,
    context: {
      projectRoot,
      configPath,
      slices,
      composedPackageNames,
      overrides: buildComposedRegistrationOverridesFromConfig(config),
      localContractNames,
      composedContractNames,
      declaredGroupNames,
    },
  };
};
