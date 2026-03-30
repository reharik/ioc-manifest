import path from "node:path";
import type { IocConfig } from "../config/iocConfig.js";
import type { ManifestRuntimePaths } from "./manifestPaths.js";

/**
 * Default layout relative to a project root: `<root>/src`, generated under `<root>/src/generated/`.
 * Callers set `projectRoot` from cwd, explicit paths, or after locating `ioc.config.ts` (including
 * monorepo layouts via `resolveProjectRootFromIocConfigPath` in `loadIocConfig`).
 */
export const defaultManifestPathsFromProjectRoot = (
  projectRoot: string,
): ManifestRuntimePaths => {
  const srcDir = path.join(projectRoot, "src");
  const generatedDir = path.join(srcDir, "generated");
  return {
    projectRoot,
    srcDir,
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

const normalizeGlobPath = (p: string): string => p.replaceAll(path.sep, "/");

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
 * Applies `ioc.config` `discovery` overrides. Always injects an exclude glob for the configured
 * output directory so the generator does not scan its own emitted `.ts` files (prevents feedback loops).
 */
export const mergeManifestOptionsWithIocConfig = (
  base: ManifestOptions,
  config: IocConfig,
): ManifestOptions => {
  const { projectRoot } = base.paths;
  const srcDir = path.resolve(projectRoot, config.discovery.rootDir);
  const configuredGeneratedDir = config.discovery.generatedDir ?? "generated";
  const generatedDir = path.isAbsolute(configuredGeneratedDir)
    ? configuredGeneratedDir
    : path.resolve(srcDir, configuredGeneratedDir);

  const generatedRelToSrc = path.relative(srcDir, generatedDir);
  const generatedExclude =
    generatedRelToSrc.length === 0
      ? "**/*"
      : `${normalizeGlobPath(generatedRelToSrc)}/**/*`;

  const mergedExcludes = config.discovery.excludes ?? base.excludePatterns;
  const excludePatterns = mergedExcludes.includes(generatedExclude)
    ? mergedExcludes
    : [...mergedExcludes, generatedExclude];
  return {
    ...base,
    paths: {
      projectRoot,
      srcDir,
      generatedDir,
      manifestOutPath: path.join(generatedDir, "ioc-manifest.ts"),
    },
    includePatterns: config.discovery.includes ?? base.includePatterns,
    excludePatterns,
    factoryExportPrefix: config.discovery.factoryPrefix ?? base.factoryExportPrefix,
  };
};
