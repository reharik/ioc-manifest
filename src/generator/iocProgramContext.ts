/**
 * @fileoverview TypeScript program bootstrap for discovery: resolve `tsconfig.json`, collect root
 * files via fast-glob from each `scanDirs` entry, and surface compiler diagnostics that affect factory typing.
 */
import path from "node:path";
import ts from "typescript";
import fg from "fast-glob";
import {
  generatedExcludePatternForScanRoot,
  type ResolvedScanDir,
} from "./manifestPaths.js";

const normalizePath = (p: string): string => path.normalize(p);

/** Absolute paths sorted lexically; globs run per scan root with merged manifest options. */
export const getDiscoveryTargetFiles = async (
  scanDirs: ResolvedScanDir[],
  includePatterns: string[],
  excludePatterns: string[],
  generatedDir: string,
): Promise<string[]> => {
  const genAbs = path.normalize(generatedDir);
  const hits = await Promise.all(
    scanDirs.map(({ absPath }) =>
      fg(includePatterns, {
        cwd: absPath,
        absolute: true,
        ignore: [
          ...excludePatterns,
          generatedExcludePatternForScanRoot(absPath, genAbs),
        ],
      }),
    ),
  );
  const unique = [...new Set(hits.flat().map((p) => normalizePath(p)))];
  return unique.sort((a, b) => a.localeCompare(b));
};

/**
 * Loads the workspace `tsconfig.json` and creates a program over `rootNames` only (typically
 * discovery targets). Compiler options (paths, module resolution) match your project build.
 */
export const createIocProgramForDiscovery = (
  projectRoot: string,
  rootNames: string[],
): ts.Program => {
  const formatHost: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => projectRoot,
    getNewLine: () => "\n",
  };

  const configPath = ts.findConfigFile(
    projectRoot,
    ts.sys.fileExists,
    "tsconfig.json",
  );
  if (!configPath) {
    throw new Error("[ioc] tsconfig.json not found");
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.formatDiagnostic(configFile.error, formatHost));
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  );

  if (parsed.errors.length > 0) {
    const msg = parsed.errors
      .map((d) => ts.formatDiagnostic(d, formatHost))
      .join("\n");
    throw new Error(`[ioc] tsconfig parse errors:\n${msg}`);
  }
  return ts.createProgram({ rootNames, options: parsed.options });
};

const formatDiagnostics = (
  diagnostics: readonly ts.Diagnostic[],
  projectRoot: string,
): string => {
  if (diagnostics.length === 0) {
    return "";
  }

  const formatHost: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => projectRoot,
    getNewLine: () => "\n",
  };

  return ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost);
};

export const reportDiscoveryProgramDiagnostics = (
  program: ts.Program,
  projectRoot: string,
  rootNames: readonly string[],
): void => {
  const relevantRootFiles = new Set(
    rootNames.map((fileName) => normalizePath(fileName)),
  );

  const diagnostics = ts.getPreEmitDiagnostics(program).filter((diagnostic) => {
    if (diagnostic.file === undefined) {
      return true;
    }
    return relevantRootFiles.has(normalizePath(diagnostic.file.fileName));
  });

  if (diagnostics.length === 0) {
    return;
  }

  const errorDiagnostics = diagnostics.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );

  const warningDiagnostics = diagnostics.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Warning,
  );

  console.warn(
    `[ioc] Continuing despite TypeScript diagnostics: ${errorDiagnostics.length} error(s), ${warningDiagnostics.length} warning(s).`,
  );

  const rendered = formatDiagnostics(diagnostics, projectRoot);
  if (rendered.length > 0) {
    console.warn(rendered);
  }
};
