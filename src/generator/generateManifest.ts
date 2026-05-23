/**
 * @fileoverview Orchestrates manifest generation: load config, discover factories via TypeScript,
 * build registration + group plans, emit `ioc-manifest.ts` and `ioc-registry.types.ts`, then
 * format with Prettier when available.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  tryLoadIocConfig,
  resolveIocConfigPath,
  resolveProjectRootFromIocConfigPath,
} from "../config/loadIocConfig.js";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import {
  createIocProgramForDiscovery,
  getDiscoveryTargetFiles,
  logDiscoveryProgramErrorDiagnosticsForFailure,
} from "./iocProgramContext.js";
import {
  mergeManifestOptionsWithIocConfig,
  ManifestOptions,
  resolveManifestOptions,
} from "./manifestOptions.js";
import { analyzeDemandSupply } from "./analyzeDemandSupply/index.js";
import { buildRegistrationPlan } from "./resolveRegistrationPlan.js";
import {
  buildManifestArtifactSources,
  writeGeneratedFilesAtomically,
} from "./writeManifest.js";
import type { ManifestRuntimePaths } from "./manifestPaths.js";
import { buildGroupPlan } from "../groups/resolveGroupPlan.js";
import {
  isAppMode,
  isLibraryMode,
  resolveManifestExportPath,
} from "../config/iocMode.js";
import { loadComposedManifestContractNames } from "./loadComposedManifestContracts.js";
import { validateGroupBaseTypeAliasKeysAtCodegen } from "./loadComposedManifestGroups.js";
import { buildComposedRegistrationOverridesFromConfig } from "./buildComposedRegistrationOverrides.js";
import {
  buildComposedManifestSource,
  removeComposedManifestIfPresent,
  resolveComposedPackageSpecs,
} from "./writeComposedManifest.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { name?: unknown };
const packageName =
  typeof packageJson.name === "string" && packageJson.name.length > 0
    ? packageJson.name
    : "ioc-manifest";

const resolvePrettierCliPath = (): string | undefined => {
  try {
    return path.join(
      path.dirname(require.resolve("prettier/package.json")),
      "bin",
      "prettier.cjs",
    );
  } catch {
    return undefined;
  }
};

/**
 * Format via the consumer's `prettier` dependency when available.
 * If prettier is not installed, generation still succeeds — files are just unformatted.
 */
const formatGeneratedFileWithPrettier = (
  filePath: string,
  projectRoot: string,
): void => {
  const prettierCliPath = resolvePrettierCliPath();
  if (prettierCliPath === undefined) {
    return;
  }

  try {
    execFileSync(process.execPath, [prettierCliPath, "--write", filePath], {
      cwd: projectRoot,
      stdio: "inherit",
      env: process.env,
    });
  } catch (error) {
    console.warn(
      `Failed to format generated files: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/**
 * Full generation pipeline for a consuming project. Idempotent writes use atomic rename.
 *
 * @param overrides - Optional paths, glob patterns, factory prefix, or explicit `iocConfigPath`.
 *                    When `ioc.config.ts` is absent, defaults from {@link resolveManifestOptions} apply.
 */
export const generateManifest = async (
  overrides?: Partial<Omit<ManifestOptions, "paths">> & {
    paths?: Partial<ManifestRuntimePaths>;
    iocConfigPath?: string;
  },
): Promise<void> => {
  const searchStart = path.resolve(
    overrides?.paths?.projectRoot ?? process.cwd(),
  );
  const configPath = resolveIocConfigPath(
    searchStart,
    overrides?.iocConfigPath,
  );
  const config = await tryLoadIocConfig(configPath);
  const resolvedProjectRoot = config
    ? resolveProjectRootFromIocConfigPath(configPath)
    : searchStart;
  const base = resolveManifestOptions({
    ...overrides,
    paths: {
      ...overrides?.paths,
      projectRoot: resolvedProjectRoot,
    },
  });
  const options = config
    ? mergeManifestOptionsWithIocConfig(base, config)
    : base;

  const {
    paths: { projectRoot, scanDirs, generatedDir, manifestOutPath },
    includePatterns,
    excludePatterns,
    factoryExportPrefix,
  } = options;

  await fs.mkdir(generatedDir, { recursive: true });

  const files = await getDiscoveryTargetFiles(
    scanDirs,
    includePatterns,
    excludePatterns,
    generatedDir,
  );
  const program = createIocProgramForDiscovery(projectRoot, files);

  try {
  const { contractMap, acceptedFactories } = discoverFactories(
    files,
    program,
    projectRoot,
    factoryExportPrefix,
    { projectRoot, scanDirs, generatedDir },
    config,
  );

  const composedContractNames =
    config !== undefined && isAppMode(config)
      ? await loadComposedManifestContractNames(
          projectRoot,
          config.composedManifests!,
        )
      : undefined;

  const plans = buildRegistrationPlan(contractMap, config, {
    projectRoot,
    scanDirs,
    composedContractNames,
  });
  const groupResult = buildGroupPlan(config?.groups, plans, {
    program,
    generatedDir,
    scanDirs,
  });

  const demandSupply = analyzeDemandSupply(acceptedFactories, {
    program,
    projectRoot,
    scanDirs,
    generatedDir,
    groupsManifest: groupResult?.manifest,
  });

  const writeOptions = {
    demandSupply,
    registryTypesBuildContext: {
      program,
      generatedDir,
      scanDirs,
    },
  };

  const artifactSources = buildManifestArtifactSources(
    acceptedFactories,
    plans,
    groupResult?.manifest,
    manifestOutPath,
    packageName,
    writeOptions,
  );

  const filesToWrite: { path: string; contents: string }[] = [
    { path: manifestOutPath, contents: artifactSources.mainSource },
    { path: artifactSources.typesPath, contents: artifactSources.typesSource },
  ];

  let composedOutPath: string | undefined;
  if (config !== undefined && isAppMode(config)) {
    const configPath = resolveIocConfigPath(
      resolvedProjectRoot,
      overrides?.iocConfigPath,
    );
    await validateGroupBaseTypeAliasKeysAtCodegen(
      resolvedProjectRoot,
      config,
      configPath,
    );
    const composedPackages = resolveComposedPackageSpecs(
      config.composedManifests!,
    );
    const composedOverrides =
      buildComposedRegistrationOverridesFromConfig(config);
    composedOutPath = path.join(generatedDir, "ioc-composed.ts");
    const composedSource = buildComposedManifestSource({
      generatedDir,
      composedPackages,
      overrides: composedOverrides,
    });
    filesToWrite.push({ path: composedOutPath, contents: composedSource });
  }

  try {
    await writeGeneratedFilesAtomically(filesToWrite);
  } catch (error) {
    if (composedOutPath !== undefined) {
      await removeComposedManifestIfPresent(generatedDir);
    }
    throw error;
  }

  if (config === undefined || isLibraryMode(config)) {
    await removeComposedManifestIfPresent(generatedDir);
  }

  formatGeneratedFileWithPrettier(manifestOutPath, projectRoot);
  formatGeneratedFileWithPrettier(artifactSources.typesPath, projectRoot);
  if (composedOutPath !== undefined) {
    formatGeneratedFileWithPrettier(composedOutPath, projectRoot);
  }

  const relManifest = path.relative(projectRoot, manifestOutPath);
  console.log(
    `Generated ${relManifest} — ${acceptedFactories.length} module factory(ies), ${contractMap.size} contract(s).`,
  );

  if (config !== undefined && isLibraryMode(config)) {
    console.log(
      `Manifest export path (configure package.json exports): ${resolveManifestExportPath(config)}`,
    );
  }

  if (config !== undefined && isAppMode(config)) {
    console.log(
      `App mode: composed ${config.composedManifests!.length} package manifest(s)`,
    );
    for (const pkg of config.composedManifests!) {
      console.log(`  - ${pkg} → import from '${pkg}/iocManifest'`);
    }
    if (composedOutPath !== undefined) {
      console.log(`Generated ${path.relative(projectRoot, composedOutPath)}`);
    }
  }
  } catch (error) {
    logDiscoveryProgramErrorDiagnosticsForFailure(
      program,
      projectRoot,
      files,
      error,
    );
    throw error;
  }
};
