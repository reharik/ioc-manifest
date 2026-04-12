import fs from "node:fs";
import path from "node:path";
import type {
  IocScanDirSpec,
  IocWorkspacePackageImportBase,
} from "../config/iocConfig.js";

const toPosix = (value: string): string => value.replace(/\\/g, "/");

const NODE_MODULES_MARKER = `${path.sep}node_modules${path.sep}`;

const DEBUG_IMPORT_SPEC = process.env.IOC_DEBUG_WORKSPACE_IMPORT_SPECS === "1";

const debugImportSpec = (message: string, detail?: Record<string, unknown>): void => {
  if (DEBUG_IMPORT_SPEC) {
    console.error(`[ioc][import-spec] ${message}`, detail ?? "");
  }
};

/**
 * Normalizes path; if it exists on disk, follows symlinks (realpath) so workspace roots match
 * TypeScript's resolved declaration paths.
 */
const tryRealpathIfExists = (p: string): string => {
  const normalized = path.normalize(p);
  try {
    if (fs.existsSync(normalized)) {
      return fs.realpathSync.native(normalized);
    }
  } catch {
    // keep normalized path
  }
  return normalized;
};

/**
 * Resolves `root` from {@link IocWorkspacePackageImportBase} to an absolute directory.
 *
 * When `ioc.config.ts` lives in an app package (e.g. `apps/web`), {@link projectRoot} is that
 * package, not the monorepo root. A path like `packages/foo/src` would incorrectly resolve to
 * `apps/web/packages/foo/src`. If that path does not exist, this walks up ancestors of
 * `projectRoot` until `path.join(ancestor, root)` exists — typically the repo root containing
 * `packages/`.
 */
export const resolveWorkspacePackageRoot = (
  projectRoot: string,
  root: string,
): string => {
  const normalizedProjectRoot = path.normalize(projectRoot);
  const rootTrimmed = root.trim().replace(/^\.(?:\/|\\)+/, "");
  if (path.isAbsolute(rootTrimmed)) {
    const n = path.normalize(rootTrimmed);
    return tryRealpathIfExists(n);
  }
  const direct = path.resolve(normalizedProjectRoot, rootTrimmed);
  if (fs.existsSync(direct)) {
    return tryRealpathIfExists(direct);
  }
  let dir = normalizedProjectRoot;
  for (let i = 0; i < 16; i += 1) {
    const candidate = path.resolve(dir, rootTrimmed);
    if (fs.existsSync(candidate)) {
      return tryRealpathIfExists(candidate);
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return direct;
};

/** After resolving `path` against the package root. */
export type ResolvedScanDir = {
  absPath: string;
  importPrefix?: string;
  importMode?: "root" | "subpath";
};

/** Resolved workspace root + import base (absolute root, longest match wins). */
export type ResolvedWorkspacePackageImportBase = {
  absRoot: string;
  importBase: string;
};

/** Resolved filesystem layout for manifest generation and factory discovery. */
export type ManifestRuntimePaths = {
  projectRoot: string;
  scanDirs: ResolvedScanDir[];
  generatedDir: string;
  /** Primary generated manifest output file. */
  manifestOutPath: string;
  /**
   * Optional workspace package roots with public import bases (from config), sorted by longest
   * `absRoot` first.
   */
  workspacePackageImportBases?: readonly ResolvedWorkspacePackageImportBase[];
};

/** Subset passed into per-file factory discovery (import path + module path math). */
export type FactoryDiscoveryPaths = Pick<
  ManifestRuntimePaths,
  "projectRoot" | "scanDirs" | "generatedDir" | "workspacePackageImportBases"
>;

export type ComputeManifestModuleSpecifierOptions = {
  /**
   * When the factory imported the contract type with a bare module specifier (e.g. `knex`,
   * `@koa/router`), preserve that instead of deriving from the resolved declaration file path.
   */
  preferredModuleSpecifier?: string;
  workspacePackageImportBases?: readonly ResolvedWorkspacePackageImportBase[];
  /**
   * IoC package root (same as manifest `projectRoot`). Used when TypeScript gives a relative
   * `SourceFile.fileName` for the contract declaration so workspace matching still works.
   */
  projectRoot?: string;
};

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
 * Maps `@types/foo` / `@types/scope__name` to the runtime package name consumers import.
 * See DefinitelyTyped naming: `@types/foo__bar` → `@foo/bar`.
 */
export const mapTypesPackageToRuntimePackage = (typesPackage: string): string => {
  const m = /^@types\/(.+)$/.exec(typesPackage);
  if (!m) {
    return typesPackage;
  }
  const body = m[1];
  if (body.includes("__")) {
    const [scope, name] = body.split("__");
    return `@${scope}/${name}`;
  }
  return body;
};

/**
 * When a resolved declaration file lives under `node_modules`, returns the bare package specifier
 * (never a relative path through `node_modules`). `@types/*` maps to the typed runtime package.
 */
export const emitBarePackageSpecifierFromNodeModulesPath = (
  absFile: string,
): string | undefined => {
  const norm = path.normalize(absFile);
  const idx = norm.lastIndexOf(NODE_MODULES_MARKER);
  if (idx === -1) {
    return undefined;
  }
  const rest = norm.slice(idx + NODE_MODULES_MARKER.length);
  const segments = rest.split(path.sep).filter(Boolean);
  if (segments.length === 0) {
    return undefined;
  }
  let pkg: string;
  if (segments[0].startsWith("@")) {
    if (segments.length < 2) {
      return undefined;
    }
    pkg = `${segments[0]}/${segments[1]}`;
  } else {
    pkg = segments[0];
  }
  if (pkg.startsWith("@types/")) {
    return mapTypesPackageToRuntimePackage(pkg);
  }
  return pkg;
};

const matchWorkspacePackageImportBase = (
  absFile: string,
  bases: readonly ResolvedWorkspacePackageImportBase[],
): ResolvedWorkspacePackageImportBase | undefined => {
  const normFile = tryRealpathIfExists(absFile);
  let best: ResolvedWorkspacePackageImportBase | undefined;
  let bestRootLen = -1;

  for (const b of bases) {
    const root = tryRealpathIfExists(b.absRoot);
    const rel = path.relative(root, normFile);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      if (root.length > bestRootLen) {
        bestRootLen = root.length;
        best = b;
      }
    }
  }

  return best;
};

const isBarePackageModuleSpecifier = (spec: string): boolean => {
  if (spec.length === 0) {
    return false;
  }
  if (spec.startsWith(".") || spec.startsWith("/")) {
    return false;
  }
  if (path.isAbsolute(spec)) {
    return false;
  }
  if (spec.includes("node_modules")) {
    return false;
  }
  return true;
};

/**
 * Strips declaration-file artifacts and redundant `/index` segments from emitted specifiers.
 * Single-segment package names (e.g. `knex`) drop `.ts`/`.js`; subpaths keep `.js` when present
 * (workspace `importPrefix` + `subpath` mode).
 */
export const normalizeEmittedModuleSpecifier = (spec: string): string => {
  let s = spec;
  s = s.replace(/\.d\.(ts|js)$/i, "");
  if (s.startsWith(".") || s.startsWith("/")) {
    s = s.replace(/\/index\.js$/i, ".js");
    return s;
  }
  if (s.includes("/")) {
    s = s.replace(/\/index\.js$/i, ".js");
    s = s.replace(/\/index$/i, "");
    return s;
  }
  s = s.replace(/\.(ts|js)$/i, "");
  s = s.replace(/\/index$/i, "");
  return s;
};

const toAbsoluteContractDeclarationPath = (
  raw: string,
  projectRoot: string | undefined,
): string => {
  const n = path.normalize(raw);
  if (path.isAbsolute(n)) {
    return n;
  }
  if (projectRoot !== undefined && projectRoot.length > 0) {
    return path.normalize(path.resolve(projectRoot, n));
  }
  return path.normalize(path.resolve(n));
};

/**
 * ESM import specifier for a source file as emitted next to `generatedDir` (relative path, package root, or subpath).
 *
 * Resolution order: optional recovered bare import → configured workspace import bases (before
 * `node_modules`, so symlinked workspace packages resolve to `importBase`) → `node_modules`
 * package name → scan dir `importPrefix` / `importMode` → relative path from `generatedDir`.
 */
export const computeManifestModuleSpecifier = (
  absFile: string,
  generatedDir: string,
  scanDirs: readonly ResolvedScanDir[],
  options?: ComputeManifestModuleSpecifierOptions,
): string => {
  const resolvedAbs = toAbsoluteContractDeclarationPath(
    absFile,
    options?.projectRoot,
  );
  const preferred = options?.preferredModuleSpecifier;
  const workspaceBases = options?.workspacePackageImportBases;

  if (DEBUG_IMPORT_SPEC) {
    debugImportSpec("computeManifestModuleSpecifier", {
      contractDeclarationFileRaw: path.normalize(absFile),
      contractDeclarationFileResolved: resolvedAbs,
      projectRoot: options?.projectRoot ?? null,
      generatedDir: path.normalize(generatedDir),
      preferredModuleSpecifier: preferred ?? null,
      workspaceBasesCount: workspaceBases?.length ?? 0,
      workspaceAbsRoots: workspaceBases?.map((b) => b.absRoot) ?? [],
    });
  }

  if (preferred !== undefined && isBarePackageModuleSpecifier(preferred)) {
    const out = normalizeEmittedModuleSpecifier(preferred);
    if (DEBUG_IMPORT_SPEC) {
      debugImportSpec("branch: preferred bare specifier", { out });
    }
    return out;
  }

  if (workspaceBases !== undefined && workspaceBases.length > 0) {
    const hit = matchWorkspacePackageImportBase(resolvedAbs, workspaceBases);
    if (hit !== undefined) {
      const out = normalizeEmittedModuleSpecifier(hit.importBase);
      if (DEBUG_IMPORT_SPEC) {
        debugImportSpec("branch: workspacePackageImportBases", {
          matchedImportBase: hit.importBase,
          matchedAbsRoot: hit.absRoot,
          out,
        });
      }
      return out;
    }
    if (DEBUG_IMPORT_SPEC) {
      debugImportSpec(
        "workspacePackageImportBases: no match (declaration file not under any configured absRoot after realpath)",
        {
          declarationFile: tryRealpathIfExists(resolvedAbs),
          triedRoots: workspaceBases.map((b) => ({
            absRoot: b.absRoot,
            realpathRoot: tryRealpathIfExists(b.absRoot),
          })),
        },
      );
    }
  } else if (DEBUG_IMPORT_SPEC) {
    debugImportSpec("workspacePackageImportBases: none passed (undefined or empty)");
  }

  const fromNode = emitBarePackageSpecifierFromNodeModulesPath(resolvedAbs);
  if (fromNode !== undefined) {
    const out = normalizeEmittedModuleSpecifier(fromNode);
    if (DEBUG_IMPORT_SPEC) {
      debugImportSpec("branch: node_modules package name", { fromNode, out });
    }
    return out;
  }

  const entry = findResolvedScanDirForFile(resolvedAbs, scanDirs);
  if (entry?.importPrefix !== undefined && entry.importMode !== undefined) {
    if (entry.importMode === "root") {
      const out = normalizeEmittedModuleSpecifier(entry.importPrefix);
      if (DEBUG_IMPORT_SPEC) {
        debugImportSpec("branch: scanDir importPrefix root", { out });
      }
      return out;
    }
    const rel = path.relative(entry.absPath, resolvedAbs);
    const posix = toPosix(rel).replace(/\.[^.]+$/, "");
    const out = normalizeEmittedModuleSpecifier(`${entry.importPrefix}/${posix}.js`);
    if (DEBUG_IMPORT_SPEC) {
      debugImportSpec("branch: scanDir importPrefix subpath", { out });
    }
    return out;
  }
  const out = normalizeEmittedModuleSpecifier(
    relativeImportFromGeneratedDir(resolvedAbs, generatedDir),
  );
  if (DEBUG_IMPORT_SPEC) {
    debugImportSpec("branch: relative from generatedDir (fallback)", { out });
  }
  return out;
};

export const resolveWorkspacePackageImportBases = (
  projectRoot: string,
  specs: readonly IocWorkspacePackageImportBase[] | undefined,
): readonly ResolvedWorkspacePackageImportBase[] | undefined => {
  if (specs === undefined || specs.length === 0) {
    return undefined;
  }
  const resolved = specs.map((s) => {
    if (typeof s.root !== "string" || s.root.length === 0) {
      throw new Error(
        "[ioc-config] discovery.workspacePackageImportBases[].root must be a non-empty string",
      );
    }
    if (typeof s.importBase !== "string" || s.importBase.length === 0) {
      throw new Error(
        "[ioc-config] discovery.workspacePackageImportBases[].importBase must be a non-empty string",
      );
    }
    return {
      absRoot: resolveWorkspacePackageRoot(projectRoot, s.root),
      importBase: s.importBase,
    };
  });
  return [...resolved].sort((a, b) => b.absRoot.length - a.absRoot.length);
};

/** Ignore glob for one scan root so discovery does not pick up generated output (relative to that root's `cwd`). */
export const generatedExcludePatternForScanRoot = (
  scanAbs: string,
  generatedAbs: string,
): string => {
  const rel = path.relative(
    path.normalize(scanAbs),
    path.normalize(generatedAbs),
  );
  if (rel.length === 0 || rel === ".") {
    return "**/*";
  }
  return `${normalizeGlobPath(rel)}/**/*`;
};
