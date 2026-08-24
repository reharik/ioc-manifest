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

/**
 * Exclusions the walk applies whatever the config's `discovery.excludes` says.
 *
 * The default excludes already list a `node_modules` pattern and a `dist` one, but a glob `ignore`
 * is ANCHORED at its scan root: it removes `<root>/node_modules` and nothing nested, and it removes
 * matched *results* rather than pruning the *walk*. Neither limitation shows up when the scan root
 * is a tight `src/factories`; both do the moment a scan root contains a package boundary, which is
 * where the freshness pass spent 223 seconds in the field.
 *
 * A directory under `node_modules` is another package by definition, and cross-package scanning was
 * removed in v2 (see {@link import("./manifestPaths.js").resolveScanDirEntries}, which refuses a
 * scan dir outside the package root). So these are not a policy the config may override — they are
 * the same boundary stated in the one place a walk can be pruned by it.
 */
export const STRUCTURAL_EXCLUDE_PATTERNS: readonly string[] = [
  "**/node_modules/**",
  "**/.git/**",
];

/**
 * Absolute paths sorted lexically; globs run per scan root with merged manifest options.
 *
 * The single enumeration: generation discovers from this, and `diagnostics/currentInputsHash.ts`
 * fingerprints exactly what it returns. Two functions that could disagree about "the scanned files"
 * would make a freshness verdict a claim about a different file set than the one generation read.
 *
 * Symlinks are NOT followed. A symlinked directory inside a scan root either leaves the package —
 * which `resolveScanDirEntries` already forbids by path — or aliases a directory inside it, which
 * would discover the same factory twice under two module paths. In an npm/pnpm/nx workspace it does
 * something worse than either: `packages/a/node_modules/@scope/b` links to `packages/b`, whose own
 * `node_modules` links back, and the walk has no end at all. Not following symlinks is what makes
 * the traversal terminating rather than merely usually-finite.
 */
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
        followSymbolicLinks: false,
        ignore: [
          ...excludePatterns,
          ...STRUCTURAL_EXCLUDE_PATTERNS,
          generatedExcludePatternForScanRoot(absPath, genAbs),
        ],
      }),
    ),
  );
  const unique = [...new Set(hits.flat().map((p) => normalizePath(p)))];
  return unique.sort((a, b) => a.localeCompare(b));
};

/**
 * Files the config's `discovery.excludes` removed from the scan: everything the include patterns
 * would have matched, minus what {@link getDiscoveryTargetFiles} actually returns.
 *
 * Read-only and inspection-only — generation never calls this, and neither call widens the scan
 * set. It runs the *same* resolution twice rather than reimplementing pattern matching, so the two
 * sets can never disagree about what an exclude pattern means. The generated directory is excluded
 * from both sides: it is tool machinery, not something the user's config chose to skip.
 */
export const getConfigExcludedFiles = async (
  scanDirs: ResolvedScanDir[],
  includePatterns: string[],
  excludePatterns: string[],
  generatedDir: string,
): Promise<string[]> => {
  if (excludePatterns.length === 0) {
    return [];
  }
  const [candidates, scanned] = await Promise.all([
    getDiscoveryTargetFiles(scanDirs, includePatterns, [], generatedDir),
    getDiscoveryTargetFiles(
      scanDirs,
      includePatterns,
      excludePatterns,
      generatedDir,
    ),
  ]);
  const kept = new Set(scanned);
  return candidates.filter((file) => !kept.has(file));
};

export type IocTsconfigContext = {
  readonly options: ts.CompilerOptions;
  readonly customConditions: readonly string[] | undefined;
};

/**
 * Parses the workspace `tsconfig.json` once. `customConditions` is returned only when
 * non-empty in compiler options (no synthetic defaults).
 */
export const loadIocTsconfigContext = (
  projectRoot: string,
): IocTsconfigContext => {
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

  const rawCustomConditions = parsed.options.customConditions;
  const customConditions =
    rawCustomConditions !== undefined && rawCustomConditions.length > 0
      ? rawCustomConditions
      : undefined;

  return { options: parsed.options, customConditions };
};

/**
 * Loads the workspace `tsconfig.json` and creates a program over `rootNames` only (typically
 * discovery targets). Compiler options (paths, module resolution) match your project build.
 */
export const createIocProgramForDiscovery = (
  projectRoot: string,
  rootNames: string[],
  tsconfig?: IocTsconfigContext,
): ts.Program => {
  const ctx = tsconfig ?? loadIocTsconfigContext(projectRoot);
  return ts.createProgram({ rootNames, options: ctx.options });
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
export const isCodegenFailureCausedByTypeScript = (error: unknown): boolean => {
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
