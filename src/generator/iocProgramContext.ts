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

const collectDiscoveryProgramErrorDiagnostics = (
  program: ts.Program,
  rootNames: readonly string[],
): readonly ts.Diagnostic[] => {
  const relevantRootFiles = new Set(
    rootNames.map((fileName) => normalizePath(fileName)),
  );

  return ts.getPreEmitDiagnostics(program).filter((diagnostic) => {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) {
      return false;
    }
    if (diagnostic.file === undefined) {
      return true;
    }
    return relevantRootFiles.has(normalizePath(diagnostic.file.fileName));
  });
};

/**
 * Formatted TypeScript errors for discovery target files only (not warnings).
 * Returns an empty string when there are no relevant errors.
 */
export const formatDiscoveryProgramErrorDiagnostics = (
  program: ts.Program,
  projectRoot: string,
  rootNames: readonly string[],
): string => {
  const diagnostics = collectDiscoveryProgramErrorDiagnostics(
    program,
    rootNames,
  );
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

/**
 * True when codegen failed in a step where TypeScript program diagnostics are likely
 * the root cause (as opposed to config, duplicate keys, etc.).
 */
export const isCodegenFailureCausedByTypeScript = (
  error: unknown,
): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message;
  return (
    message.includes("not in the TypeScript program") ||
    message.includes("cannot type-check") ||
    message.includes("Conflicting types for demanded key") ||
    message.includes("references an unresolvable type in deps")
  );
};

/**
 * Logs discovery-scoped TS errors when `error` is type-check related and diagnostics exist.
 */
export const logDiscoveryProgramErrorDiagnosticsForFailure = (
  program: ts.Program,
  projectRoot: string,
  rootNames: readonly string[],
  error: unknown,
): void => {
  if (!isCodegenFailureCausedByTypeScript(error)) {
    return;
  }

  const rendered = formatDiscoveryProgramErrorDiagnostics(
    program,
    projectRoot,
    rootNames,
  );
  if (rendered.length === 0) {
    return;
  }

  console.error(
    `[ioc] TypeScript errors in discovery target file(s):\n${rendered}`,
  );
};
