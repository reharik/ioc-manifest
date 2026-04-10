import path from "node:path";
import type { IocConfig } from "../config/iocConfig.js";
import { parseDiscoveryScanDirs } from "../config/parseDiscoveryScanDirs.js";
import {
  resolveScanDirEntries,
  type ManifestRuntimePaths,
} from "./manifestPaths.js";

/**
 * Default layout relative to a project root: scan `<root>/src`, emit under `<root>/generated/`
 * (paths always anchored at `projectRoot`).
 */
export const defaultManifestPathsFromProjectRoot = (
  projectRoot: string,
): ManifestRuntimePaths => {
  const scanDirs = resolveScanDirEntries(projectRoot, [{ path: "src" }]);
  const generatedDir = path.join(projectRoot, "generated");
  return {
    projectRoot,
    scanDirs,
    generatedDir,
    manifestOutPath: path.join(generatedDir, "ioc-manifest.ts"),
  };
};

export type ManifestOptions = {
  paths: ManifestRuntimePaths;
  includePatterns: string[];
  excludePatterns: string[];
  factoryExportPrefix: string;
};

const DEFAULT_INCLUDE_PATTERNS = ["examples/**/*.{ts,tsx,js,mjs,cjs}"];

const DEFAULT_EXCLUDE_PATTERNS = [
  "**/*.d.ts",
  "**/*.test.{ts,tsx,js,mjs,cjs}",
  "**/*.spec.{ts,tsx,js,mjs,cjs}",
  "generated/**/*",
  "dist/**/*",
  "node_modules/**/*",
];

/**
 * Snapshot defaults for patterns/prefix; `paths` use the current working directory each time they are read.
 */
export const DEFAULT_MANIFEST_OPTIONS: ManifestOptions = {
  get paths(): ManifestRuntimePaths {
    return defaultManifestPathsFromProjectRoot(process.cwd());
  },
  includePatterns: DEFAULT_INCLUDE_PATTERNS,
  excludePatterns: DEFAULT_EXCLUDE_PATTERNS,
  factoryExportPrefix: "build",
};

export const resolveManifestOptions = (
  overrides?: Partial<Omit<ManifestOptions, "paths">> & {
    paths?: Partial<ManifestRuntimePaths>;
  },
): ManifestOptions => ({
  includePatterns: overrides?.includePatterns ?? DEFAULT_INCLUDE_PATTERNS,
  excludePatterns: overrides?.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS,
  factoryExportPrefix: overrides?.factoryExportPrefix ?? "build",
  paths: {
    ...defaultManifestPathsFromProjectRoot(process.cwd()),
    ...overrides?.paths,
  },
});

/**
 * Applies `ioc.config` `discovery` overrides. Per-scan-root excludes for the generated directory
 * are applied inside {@link getDiscoveryTargetFiles} (ignore paths are relative to each scan `cwd`).
 */
export const mergeManifestOptionsWithIocConfig = (
  base: ManifestOptions,
  config: IocConfig,
): ManifestOptions => {
  const { projectRoot } = base.paths;
  const specs = parseDiscoveryScanDirs(
    config.discovery.scanDirs,
    "ioc.config discovery.scanDirs",
  );
  const scanDirs = resolveScanDirEntries(projectRoot, specs);
  const configuredGeneratedDir = config.discovery.generatedDir ?? "generated";
  const generatedDir = path.isAbsolute(configuredGeneratedDir)
    ? configuredGeneratedDir
    : path.resolve(projectRoot, configuredGeneratedDir);

  return {
    ...base,
    paths: {
      projectRoot,
      scanDirs,
      generatedDir,
      manifestOutPath: path.join(generatedDir, "ioc-manifest.ts"),
    },
    includePatterns: config.discovery.includes ?? base.includePatterns,
    excludePatterns: config.discovery.excludes ?? base.excludePatterns,
    factoryExportPrefix: config.discovery.factoryPrefix ?? base.factoryExportPrefix,
  };
};
