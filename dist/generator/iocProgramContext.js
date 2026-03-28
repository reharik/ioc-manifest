import path from "node:path";
import ts from "typescript";
import fg from "fast-glob";
const normalizePath = (p) => path.normalize(p);
export const getDiscoveryTargetFiles = async (srcDir, includePatterns, excludePatterns) => (await fg(includePatterns, {
    cwd: srcDir,
    absolute: true,
    ignore: excludePatterns,
})).sort((a, b) => a.localeCompare(b));
export const createIocProgramForDiscovery = (projectRoot, rootNames) => {
    const formatHost = {
        getCanonicalFileName: (f) => f,
        getCurrentDirectory: () => projectRoot,
        getNewLine: () => "\n",
    };
    const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, "tsconfig.json");
    if (!configPath) {
        throw new Error("[ioc] tsconfig.json not found");
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
        throw new Error(`[ioc] tsconfig parse errors:\n${msg}`);
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
export const reportDiscoveryProgramDiagnostics = (program, projectRoot, rootNames) => {
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
    console.warn(`[ioc] Continuing despite TypeScript diagnostics: ${errorDiagnostics.length} error(s), ${warningDiagnostics.length} warning(s).`);
    const rendered = formatDiagnostics(diagnostics, projectRoot);
    if (rendered.length > 0) {
        console.warn(rendered);
    }
};
//# sourceMappingURL=iocProgramContext.js.map