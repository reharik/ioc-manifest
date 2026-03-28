import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  tryLoadIocConfig,
  resolveIocConfigPath,
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
import { buildBundlePlan } from "../bundles/resolveBundlePlan.js";

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

export const generateManifest = async (
  overrides?: Partial<Omit<ManifestOptions, "paths">> & {
    paths?: Partial<ManifestRuntimePaths>;
    iocConfigPath?: string;
  },
): Promise<void> => {
  const base = resolveManifestOptions(overrides);
  const configPath = resolveIocConfigPath(
    base.paths.projectRoot,
    overrides?.iocConfigPath,
  );
  const config = await tryLoadIocConfig(configPath);
  const options = config
    ? mergeManifestOptionsWithIocConfig(base, config)
    : base;

  const {
    paths: { projectRoot, srcDir, generatedDir, manifestOutPath },
    includePatterns,
    excludePatterns,
    factoryExportPrefix,
  } = options;

  await fs.mkdir(generatedDir, { recursive: true });

  const files = await getDiscoveryTargetFiles(
    srcDir,
    includePatterns,
    excludePatterns,
  );
  const program = createIocProgramForDiscovery(projectRoot, files);
  reportDiscoveryProgramDiagnostics(program, projectRoot, files);

  const { contractMap, acceptedFactories } = discoverFactories(
    files,
    program,
    projectRoot,
    factoryExportPrefix,
    { srcDir, generatedDir },
    config,
  );

  const plans = buildRegistrationPlan(contractMap, config);
  const bundleResult = buildBundlePlan(config?.bundles, plans, {
    program,
    generatedDir,
  });

  await writeManifest(
    acceptedFactories,
    plans,
    bundleResult?.tree,
    bundleResult?.arraysInsight,
    manifestOutPath,
    packageName,
  );

  formatGeneratedFileWithPrettier(manifestOutPath, projectRoot);
  formatGeneratedFileWithPrettier(
    path.join(path.dirname(manifestOutPath), "ioc-manifest.support.ts"),
    projectRoot,
  );
  formatGeneratedFileWithPrettier(
    path.join(path.dirname(manifestOutPath), "ioc-registry.types.ts"),
    projectRoot,
  );

  console.log(
    `Generated ${path.relative(projectRoot, manifestOutPath)} — ${acceptedFactories.length} module factory(ies), ${contractMap.size} contract(s).`,
  );
};
