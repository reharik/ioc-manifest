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
  reportDiscoveryProgramDiagnostics,
} from "./iocProgramContext.js";
import {
  mergeManifestOptionsWithIocConfig,
  ManifestOptions,
  resolveManifestOptions,
} from "./manifestOptions.js";
import { buildRegistrationPlan } from "./resolveRegistrationPlan.js";
import { writeManifest } from "./writeManifest.js";
import type { ManifestRuntimePaths } from "./manifestPaths.js";
import { buildGroupPlan } from "../groups/resolveGroupPlan.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { name?: unknown };
const packageName =
  typeof packageJson.name === "string" && packageJson.name.length > 0
    ? packageJson.name
    : "ioc-manifest";
const prettierCliPath = path.join(
  path.dirname(require.resolve("prettier/package.json")),
  "bin",
  "prettier.cjs",
);

/**
 * Format via the local `prettier` dependency (not `npx`), so generation works regardless of cwd
 * or npm/npx resolution when using alternate `--config` paths.
 */
const formatGeneratedFileWithPrettier = (
  filePath: string,
  projectRoot: string,
): void => {
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
  const configPath = resolveIocConfigPath(searchStart, overrides?.iocConfigPath);
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
  reportDiscoveryProgramDiagnostics(program, projectRoot, files);

  const { contractMap, acceptedFactories } = discoverFactories(
    files,
    program,
    projectRoot,
    factoryExportPrefix,
    { projectRoot, scanDirs, generatedDir },
    config,
  );

  const plans = buildRegistrationPlan(contractMap, config);
  const groupResult = buildGroupPlan(config?.groups, plans, {
    program,
    generatedDir,
  });

  await writeManifest(
    acceptedFactories,
    plans,
    groupResult?.manifest,
    manifestOutPath,
    packageName,
    {
      registryTypesBuildContext: {
        program,
        generatedDir,
      },
    },
  );

  formatGeneratedFileWithPrettier(manifestOutPath, projectRoot);

  formatGeneratedFileWithPrettier(
    path.join(path.dirname(manifestOutPath), "ioc-registry.types.ts"),
    projectRoot,
  );

  console.log(
    `Generated ${path.relative(projectRoot, manifestOutPath)} — ${acceptedFactories.length} module factory(ies), ${contractMap.size} contract(s).`,
  );
};
