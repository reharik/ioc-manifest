import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import fg from "fast-glob";
import { tryLoadIocConfig, resolveIocConfigPath, } from "../config/loadIocConfig.js";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import { mergeManifestOptionsWithIocConfig, resolveManifestOptions, } from "./manifestOptions.js";
import { buildRegistrationPlan } from "./resolveRegistrationPlan.js";
import { writeManifest } from "./writeManifest.js";
import { buildBundlePlan } from "../bundles/resolveBundlePlan.js";
const require = createRequire(import.meta.url);
const prettierCliPath = path.join(path.dirname(require.resolve("prettier/package.json")), "bin", "prettier.cjs");
/**
 * Format via the local `prettier` dependency (not `npx`), so generation works regardless of cwd
 * or npm/npx resolution when using alternate `--config` paths.
 */
const formatGeneratedFileWithPrettier = (filePath, projectRoot) => {
    try {
        execFileSync(process.execPath, [prettierCliPath, "--write", filePath], {
            cwd: projectRoot,
            stdio: "inherit",
            env: process.env,
        });
    }
    catch (error) {
        console.warn(`Failed to format generated files: ${error instanceof Error ? error.message : String(error)}`);
    }
};
const getTargetFiles = async (srcDir, includePatterns, excludePatterns) => (await fg(includePatterns, {
    cwd: srcDir,
    absolute: true,
    ignore: excludePatterns,
})).sort((a, b) => a.localeCompare(b));
const normalizePath = (p) => path.normalize(p);
const getTSProgram = (projectRoot, rootNames) => {
    const formatHost = {
        getCanonicalFileName: (f) => f,
        getCurrentDirectory: () => projectRoot,
        getNewLine: () => "\n",
    };
    const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, "tsconfig.json");
    if (!configPath) {
        throw new Error("[gen-manifest] tsconfig.json not found");
    }
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
        throw new Error(ts.formatDiagnostic(configFile.error, formatHost));
    }
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath), undefined, configPath);
    if (parsed.errors.length > 0) {
        const msg = parsed.errors
            .map((d) => ts.formatDiagnostic(d, formatHost))
            .join("\n");
        throw new Error(`[gen-manifest] tsconfig parse errors:\n${msg}`);
    }
    return ts.createProgram({ rootNames, options: parsed.options });
};
const formatDiagnostics = (diagnostics, projectRoot) => {
    if (diagnostics.length === 0) {
        return "";
    }
    const formatHost = {
        getCanonicalFileName: (f) => f,
        getCurrentDirectory: () => projectRoot,
        getNewLine: () => "\n",
    };
    return ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost);
};
const reportNonFatalProgramDiagnostics = (program, projectRoot, rootNames) => {
    const relevantRootFiles = new Set(rootNames.map((fileName) => normalizePath(fileName)));
    const diagnostics = ts.getPreEmitDiagnostics(program).filter((diagnostic) => {
        if (diagnostic.file === undefined) {
            return true;
        }
        return relevantRootFiles.has(normalizePath(diagnostic.file.fileName));
    });
    if (diagnostics.length === 0) {
        return;
    }
    const errorDiagnostics = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
    const warningDiagnostics = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Warning);
    console.warn(`[gen-manifest] Continuing despite TypeScript diagnostics: ${errorDiagnostics.length} error(s), ${warningDiagnostics.length} warning(s).`);
    const rendered = formatDiagnostics(diagnostics, projectRoot);
    if (rendered.length > 0) {
        console.warn(rendered);
    }
};
export const generateManifest = async (overrides) => {
    const base = resolveManifestOptions(overrides);
    const configPath = resolveIocConfigPath(base.paths.projectRoot, overrides?.iocConfigPath);
    const config = await tryLoadIocConfig(configPath);
    const options = config
        ? mergeManifestOptionsWithIocConfig(base, config)
        : base;
    const { paths: { projectRoot, srcDir, generatedDir, manifestOutPath }, includePatterns, excludePatterns, factoryExportPrefix, } = options;
    await fs.mkdir(generatedDir, { recursive: true });
    const files = await getTargetFiles(srcDir, includePatterns, excludePatterns);
    const program = getTSProgram(projectRoot, files);
    reportNonFatalProgramDiagnostics(program, projectRoot, files);
    const { contractMap, acceptedFactories } = discoverFactories(files, program, projectRoot, factoryExportPrefix, { srcDir, generatedDir }, config);
    const plans = buildRegistrationPlan(contractMap, config);
    const bundlesPlan = buildBundlePlan(config?.bundles, plans);
    await writeManifest(acceptedFactories, plans, bundlesPlan, manifestOutPath, projectRoot);
    formatGeneratedFileWithPrettier(manifestOutPath, projectRoot);
    formatGeneratedFileWithPrettier(path.join(path.dirname(manifestOutPath), "ioc-registry.types.ts"), projectRoot);
    console.log(`Generated ${path.relative(projectRoot, manifestOutPath)} — ${acceptedFactories.length} module factory(ies), ${contractMap.size} contract(s).`);
};
//# sourceMappingURL=generateManifest.js.map