import path from "node:path";
import { fileURLToPath } from "node:url";
const generatorDir = path.dirname(fileURLToPath(import.meta.url));
const defaultSrcDir = path.resolve(generatorDir, "..");
const defaultProjectRoot = path.resolve(defaultSrcDir, "..");
const defaultGeneratedDir = path.join(defaultSrcDir, "generated");
const defaultPaths = {
    projectRoot: defaultProjectRoot,
    srcDir: defaultSrcDir,
    generatedDir: defaultGeneratedDir,
    manifestOutPath: path.join(defaultGeneratedDir, "ioc-manifest.ts"),
};
export const DEFAULT_MANIFEST_OPTIONS = {
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
const normalizeGlobPath = (p) => p.replaceAll(path.sep, "/");
export const resolveManifestOptions = (overrides) => ({
    ...DEFAULT_MANIFEST_OPTIONS,
    ...overrides,
    paths: {
        ...DEFAULT_MANIFEST_OPTIONS.paths,
        ...overrides?.paths,
    },
});
export const mergeManifestOptionsWithIocConfig = (base, config) => {
    const { projectRoot } = base.paths;
    const srcDir = path.resolve(projectRoot, config.discovery.rootDir);
    const configuredGeneratedDir = config.discovery.generatedDir ?? "generated";
    const generatedDir = path.isAbsolute(configuredGeneratedDir)
        ? configuredGeneratedDir
        : path.resolve(srcDir, configuredGeneratedDir);
    const generatedRelToSrc = path.relative(srcDir, generatedDir);
    const generatedExclude = generatedRelToSrc.length === 0
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
//# sourceMappingURL=manifestOptions.js.map