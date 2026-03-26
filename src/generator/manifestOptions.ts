import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IocConfig } from "../config/iocConfig.js";
import type { ManifestRuntimePaths } from "./manifestPaths.js";

const generatorDir = path.dirname(fileURLToPath(import.meta.url));
const defaultSrcDir = path.resolve(generatorDir, "..");
const defaultProjectRoot = path.resolve(defaultSrcDir, "..");
const defaultGeneratedDir = path.join(defaultSrcDir, "generated");

const defaultPaths: ManifestRuntimePaths = {
  projectRoot: defaultProjectRoot,
  srcDir: defaultSrcDir,
  generatedDir: defaultGeneratedDir,
  manifestOutPath: path.join(defaultGeneratedDir, "ioc-manifest.ts"),
};

export type ManifestOptions = {
  paths: ManifestRuntimePaths;
  includePatterns: string[];
  excludePatterns: string[];
  factoryExportPrefix: string;
};

export const DEFAULT_MANIFEST_OPTIONS: ManifestOptions = {
  paths: defaultPaths,
  includePatterns: ["examples/**/*.{ts,tsx,js,mjs,cjs}"],
  excludePatterns: [
    "**/*.d.ts",
    "**/*.test.{ts,tsx,js,mjs,cjs}",
    "**/*.spec.{ts,tsx,js,mjs,cjs}",
    "generated/**/*",
    "dist/**/*",
    "node_modules/**/*",
  ],
  factoryExportPrefix: "build",
};

const normalizeGlobPath = (p: string): string => p.replaceAll(path.sep, "/");

export const resolveManifestOptions = (
  overrides?: Partial<Omit<ManifestOptions, "paths">> & {
    paths?: Partial<ManifestRuntimePaths>;
  },
): ManifestOptions => ({
  ...DEFAULT_MANIFEST_OPTIONS,
  ...overrides,
  paths: {
    ...DEFAULT_MANIFEST_OPTIONS.paths,
    ...overrides?.paths,
  },
});

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
