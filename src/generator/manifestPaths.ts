import path from "node:path";
import type { IocLifetime, IocScanDirSpec } from "../config/iocConfig.js";

const toPosix = (value: string): string => value.replace(/\\/g, "/");

const NODE_MODULES_MARKER = `${path.sep}node_modules${path.sep}`;

/** After resolving `path` against the package root. Optional `scope` is default registration lifetime for factories under this root. */
export type ResolvedScanDir = {
  absPath: string;
  scope?: IocLifetime;
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

export type ComputeManifestModuleSpecifierOptions = {
  /**
   * When the factory imported the contract type with a bare module specifier (e.g. `knex`,
   * `@koa/router`), preserve that instead of deriving from the resolved declaration file path.
   */
  preferredModuleSpecifier?: string;
  /**
   * IoC package root (same as manifest `projectRoot`). Used when TypeScript gives a relative
   * `SourceFile.fileName` for the contract declaration.
   */
  projectRoot?: string;
};

const normalizeGlobPath = (p: string): string => p.replaceAll(path.sep, "/");

export const resolveScanDirEntries = (
  projectRoot: string,
  specs: readonly IocScanDirSpec[],
): ResolvedScanDir[] => {
  const packageRoot = path.normalize(projectRoot);
  return specs.map((s) => {
    const absPath = path.isAbsolute(s.path)
      ? path.normalize(s.path)
      : path.resolve(packageRoot, s.path);
    const rel = path.relative(packageRoot, absPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(
        `[ioc-config] scanDir ${JSON.stringify(s.path)} resolves outside the package root. Cross-package scanning was removed in v2; use composedManifests instead.`,
      );
    }
    return {
      absPath,
      ...(s.scope !== undefined ? { scope: s.scope } : {}),
    };
  });
};

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

/**
 * Default registration lifetime from the most specific `discovery.scanDirs` root containing the
 * factory file. Throws when multiple roots tie for specificity with different paths or conflicting
 * `scope` on duplicate entries.
 */
export const resolveDiscoveryRootDefaultLifetime = (
  factoryAbsPath: string,
  scanDirs: readonly ResolvedScanDir[],
): IocLifetime | undefined => {
  const normFile = path.normalize(factoryAbsPath);
  const containing = scanDirs.filter((e) => {
    const root = path.normalize(e.absPath);
    const rel = path.relative(root, normFile);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  });

  if (containing.length === 0) {
    return undefined;
  }

  const maxLen = Math.max(
    ...containing.map((e) => path.normalize(e.absPath).length),
  );
  const longest = containing.filter(
    (e) => path.normalize(e.absPath).length === maxLen,
  );

  const uniqueRoots = [
    ...new Set(longest.map((e) => path.normalize(e.absPath))),
  ];
  if (uniqueRoots.length > 1) {
    throw new Error(
      `[ioc-config] Factory module ${JSON.stringify(
        normFile,
      )} is contained in multiple discovery.scanDirs roots with equal specificity (${uniqueRoots.join(
        ", ",
      )}). Set discovery-root scope only when each factory maps to a single winning root, or use registrations[Contract][implementation].lifetime to disambiguate.`,
    );
  }

  const definedScopes = longest
    .map((e) => e.scope)
    .filter((s): s is IocLifetime => s !== undefined);

  if (definedScopes.length === 0) {
    return undefined;
  }

  const distinct = [...new Set(definedScopes)];
  if (distinct.length > 1) {
    throw new Error(
      `[ioc-config] discovery.scanDirs lists duplicate entries for root ${JSON.stringify(
        uniqueRoots[0],
      )} with conflicting scope values (${distinct.join(", ")}).`,
    );
  }

  return distinct[0];
};

const useSingleLocalScanRoot = (entries: readonly ResolvedScanDir[]): boolean =>
  entries.length === 1;

/**
 * Stable `modulePath` for manifest indexing: relative to the sole scan root when there is one;
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

/**
 * True when a relative import resolved from `generatedDir` lands outside `packageRoot`.
 */
export const relativeImportEscapesPackageRoot = (
  relImport: string,
  generatedDir: string,
  packageRoot: string,
): boolean => {
  if (!relImport.startsWith(".")) {
    return false;
  }
  const withoutJs = relImport.replace(/\.js$/i, "");
  const resolved = path.normalize(path.resolve(generatedDir, withoutJs));
  const rel = path.relative(path.normalize(packageRoot), resolved);
  return rel.startsWith("..") || path.isAbsolute(rel);
};

export const formatRelativeImportEscapesPackageRootWarning = (
  relImport: string,
): string =>
  `[ioc-warn] Generated import ${JSON.stringify(relImport)} escapes the package root.\n` +
  `This usually means a factory imports a type via a deep relative path instead of the\n` +
  `package's public API. Consider importing via the bare package specifier (e.g.\n` +
  `"@packages/other-package") in the factory source.`;

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
 * Single-segment package names (e.g. `knex`) drop `.ts`/`.js`; subpaths keep `.js` when present.
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
 * ESM import specifier for a source file as emitted next to `generatedDir` (relative path or bare
 * package name from `node_modules`).
 *
 * Resolution order: optional recovered bare import → `node_modules` package name → relative path
 * from `generatedDir`.
 */
export const computeManifestModuleSpecifier = (
  absFile: string,
  generatedDir: string,
  _scanDirs: readonly ResolvedScanDir[],
  options?: ComputeManifestModuleSpecifierOptions,
): string => {
  const resolvedAbs = toAbsoluteContractDeclarationPath(
    absFile,
    options?.projectRoot,
  );
  const preferred = options?.preferredModuleSpecifier;

  if (preferred !== undefined && isBarePackageModuleSpecifier(preferred)) {
    return normalizeEmittedModuleSpecifier(preferred);
  }

  const fromNode = emitBarePackageSpecifierFromNodeModulesPath(resolvedAbs);
  if (fromNode !== undefined) {
    return normalizeEmittedModuleSpecifier(fromNode);
  }

  return normalizeEmittedModuleSpecifier(
    relativeImportFromGeneratedDir(resolvedAbs, generatedDir),
  );
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
