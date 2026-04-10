import path from "node:path";
import type { IocScanDirSpec } from "../config/iocConfig.js";

const toPosix = (value: string): string => value.replace(/\\/g, "/");

/** After resolving `path` against the package root. */
export type ResolvedScanDir = {
  absPath: string;
  importPrefix?: string;
  importMode?: "root" | "subpath";
};

/** Resolved filesystem layout for manifest generation and factory discovery. */
export type ManifestRuntimePaths = {
  projectRoot: string;
  scanDirs: ResolvedScanDir[];
  generatedDir: string;
  /** Primary generated manifest output file. */
  manifestOutPath: string;
};

/** Subset passed into per-file factory discovery (import path + module path math). */
export type FactoryDiscoveryPaths = Pick<
  ManifestRuntimePaths,
  "projectRoot" | "scanDirs" | "generatedDir"
>;

const normalizeGlobPath = (p: string): string => p.replaceAll(path.sep, "/");

export const resolveScanDirEntries = (
  projectRoot: string,
  specs: readonly IocScanDirSpec[],
): ResolvedScanDir[] =>
  specs.map((s) => {
    const absPath = path.isAbsolute(s.path)
      ? path.normalize(s.path)
      : path.resolve(projectRoot, s.path);
    if (s.importPrefix !== undefined && s.importMode !== undefined) {
      return {
        absPath,
        importPrefix: s.importPrefix,
        importMode: s.importMode,
      };
    }
    return { absPath };
  });

export const findResolvedScanDirForFile = (
  absFile: string,
  entries: readonly ResolvedScanDir[],
): ResolvedScanDir | undefined => {
  const normFile = path.normalize(absFile);
  let best: ResolvedScanDir | undefined;
  let bestRootLen = -1;

  for (const e of entries) {
    const root = path.normalize(e.absPath);
    const rel = path.relative(root, normFile);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      if (root.length > bestRootLen) {
        bestRootLen = root.length;
        best = e;
      }
    }
  }

  return best;
};

const useSingleLocalScanRoot = (entries: readonly ResolvedScanDir[]): boolean =>
  entries.length === 1 && entries[0].importPrefix === undefined;

/**
 * Stable `modulePath` for manifest indexing: relative to the sole local scan root when there is one;
 * otherwise relative to `projectRoot` (posix) so paths stay unique.
 */
export const computeDiscoveryModulePath = (
  absFile: string,
  projectRoot: string,
  scanDirs: readonly ResolvedScanDir[],
): string => {
  const normalizedFile = path.normalize(absFile);
  if (useSingleLocalScanRoot(scanDirs)) {
    return toPosix(
      path.relative(path.normalize(scanDirs[0].absPath), normalizedFile),
    );
  }
  return toPosix(path.relative(path.normalize(projectRoot), normalizedFile));
};

/** Resolves the absolute path of a factory module from its stored `modulePath`. */
export const resolveFactorySourceAbsPath = (
  modulePath: string,
  projectRoot: string,
  scanDirs: readonly ResolvedScanDir[],
): string => {
  if (useSingleLocalScanRoot(scanDirs)) {
    return path.normalize(path.join(scanDirs[0].absPath, modulePath));
  }
  return path.normalize(path.join(projectRoot, modulePath));
};

const relativeImportFromGeneratedDir = (
  absFile: string,
  generatedDir: string,
): string => {
  let rel = path.relative(generatedDir, absFile);
  rel = toPosix(rel).replace(/\.[^.]+$/, "");
  if (!rel.startsWith(".")) {
    rel = `./${rel}`;
  }
  return `${rel}.js`;
};

/**
 * ESM import specifier for a source file as emitted next to `generatedDir` (relative path, package root, or subpath).
 */
export const computeManifestModuleSpecifier = (
  absFile: string,
  generatedDir: string,
  scanDirs: readonly ResolvedScanDir[],
): string => {
  const entry = findResolvedScanDirForFile(absFile, scanDirs);
  if (
    entry?.importPrefix !== undefined &&
    entry.importMode !== undefined
  ) {
    if (entry.importMode === "root") {
      return entry.importPrefix;
    }
    const rel = path.relative(entry.absPath, path.normalize(absFile));
    const posix = toPosix(rel).replace(/\.[^.]+$/, "");
    return `${entry.importPrefix}/${posix}.js`;
  }
  return relativeImportFromGeneratedDir(absFile, generatedDir);
};

/** Ignore glob for one scan root so discovery does not pick up generated output (relative to that root's `cwd`). */
export const generatedExcludePatternForScanRoot = (
  scanAbs: string,
  generatedAbs: string,
): string => {
  const rel = path.relative(path.normalize(scanAbs), path.normalize(generatedAbs));
  if (rel.length === 0 || rel === ".") {
    return "**/*";
  }
  return `${normalizeGlobPath(rel)}/**/*`;
};
