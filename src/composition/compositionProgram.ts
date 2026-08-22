/**
 * @fileoverview The ONE program every composition check reasons over — for `ioc generate` in app
 * mode and for `ioc validate` alike.
 *
 * ### Why there is only one
 *
 * Validate used to build its own program: the generated registry-types files of several packages
 * as root names, nothing else. That is a shape no real build ever compiles, and it gave answers a
 * real build disagreed with. In one tree state the identical comparison —
 * `IocExternals['userRepository']` against the composed `IocGeneratedCradle['userRepository']` —
 * was ASSIGNABLE under the app's own `tsc --noEmit -p tsconfig.json` (clean) and INCOMPATIBLE
 * under validate's synthetic program (three `[externals]` type-incompatible lines). Same files,
 * opposite verdicts, and the synthetic one was wrong.
 *
 * ### The mechanism
 *
 * A workspace package is installed as a SYMLINK: `node_modules/@scope/lib → ../../packages/lib`.
 * TypeScript, with `preserveSymlinks` off (the default), realpaths the result of every MODULE
 * resolution — so when the app's own sources reach into that package, the `SourceFile` they get is
 * keyed by the real path under `packages/lib`. Root names, by contrast, are taken verbatim.
 * Validate rooted the composed registry file by the path `resolvePackageExportPath` hands back,
 * which is the `node_modules` symlink path. One physical file therefore entered the program TWICE,
 * as two `SourceFile`s with two sets of declarations — and a class in the compared chain (anything
 * nominal: private or protected members) is not assignable to its own copy. Every comparison whose
 * chain touched such a class failed for a reason that had nothing to do with the code.
 *
 * ### What this module guarantees
 *
 * 1. The program is built from the app's own tsconfig, rooted over the app's full source set,
 *    resolving the way the app's `tsc` resolves. Defaulting to the env is the point: a check that
 *    disagrees with the build it is guarding is worse than no check.
 * 2. Every physical file is admitted exactly ONCE. Root names are realpathed before they are
 *    handed to TypeScript, so a root reached by a symlink is the same `SourceFile` a module
 *    resolution produces.
 * 3. {@link assertNoDuplicateSourceFiles} then proves it, and hard-errors naming both paths if it
 *    is ever untrue again. This class of defect is silent by nature — it produces confident,
 *    plausible, wrong verdicts — so it gets a guard rather than a comment.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  loadIocTsconfigContext,
  type IocTsconfigContext,
} from "../generator/iocProgramContext.js";

export type CompositionProgramContext = {
  readonly checker: ts.TypeChecker;
  readonly program: ts.Program;
  readonly customConditions: readonly string[] | undefined;
  /**
   * Maps a caller-supplied path to the path the program actually keyed the file under.
   * Callers hold paths from `resolvePackageExportPath` (symlinked); lookups must go through here.
   */
  readonly canonicalPathFor: (filePath: string) => string;
};

/**
 * The workspace's compiler options, minus everything that only describes an EMIT LAYOUT.
 *
 * The program is read-only and emits nothing, and its roots include generated registry files from
 * OTHER packages — a composition the app's own build never makes. Options that constrain where
 * sources may live relative to an output directory then complain about this construction rather
 * than about the files: `rootDir: packages/app/src` reports TS6059 against a composed package's
 * registry file for the crime of not being under the app, which the app's own `tsc` never says
 * because it never makes that file a root.
 *
 * None of these affect how a NAME RESOLVES or how two types COMPARE, which is the whole of what
 * this program is asked. Everything that does affect resolution — `paths`, `moduleResolution`,
 * `customConditions`, `lib`, `strict`, `exactOptionalPropertyTypes` — is left exactly as the app
 * declares it.
 */
export const readOnlyProgramOptions = (
  options: ts.CompilerOptions,
): ts.CompilerOptions => {
  const {
    rootDir: _rootDir,
    rootDirs: _rootDirs,
    outDir: _outDir,
    outFile: _outFile,
    declarationDir: _declarationDir,
    composite: _composite,
    incremental: _incremental,
    tsBuildInfoFile: _tsBuildInfoFile,
    ...rest
  } = options;
  return { ...rest, noEmit: true, declaration: false, declarationMap: false };
};

const tryRealpath = (filePath: string): string => {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return filePath;
  }
};

/**
 * The path TypeScript will key this file under, given the app's `preserveSymlinks` setting.
 *
 * With `preserveSymlinks` off (the default, and what every workspace build runs) TS realpaths
 * module resolutions, so a root must be realpathed to match. With it ON, TS deliberately keeps
 * symlink paths, and realpathing the root would introduce the very divergence in the other
 * direction — so the setting is honoured rather than overridden.
 */
export const canonicalProgramPath = (
  filePath: string,
  options: ts.CompilerOptions,
): string =>
  options.preserveSymlinks === true
    ? path.normalize(filePath)
    : tryRealpath(path.normalize(filePath));

const isUnderNodeModules = (filePath: string): boolean =>
  filePath.split(path.sep).includes("node_modules");

/**
 * Two `SourceFile`s for one physical file — the defect described in the file overview.
 *
 * Only files whose REAL path is outside `node_modules` are adjudicated. That is precisely the
 * workspace-symlink class this guard exists for (a real path under `packages/*`, reached both
 * directly and through `node_modules/@scope/pkg`). A package manager that stores physical files
 * inside `node_modules` and links them around — pnpm's `.pnpm` store being the obvious one —
 * produces realpaths that live there, and hard-erroring a user's run over their installer's
 * layout would be hostile and is not what broke the comparisons.
 */
export const assertNoDuplicateSourceFiles = (program: ts.Program): void => {
  const byRealPath = new Map<string, string[]>();

  for (const sourceFile of program.getSourceFiles()) {
    const real = tryRealpath(sourceFile.fileName);
    if (isUnderNodeModules(real)) {
      continue;
    }
    const seen = byRealPath.get(real);
    if (seen === undefined) {
      byRealPath.set(real, [sourceFile.fileName]);
      continue;
    }
    if (!seen.includes(sourceFile.fileName)) {
      seen.push(sourceFile.fileName);
    }
  }

  const duplicates = [...byRealPath.entries()]
    .filter(([, paths]) => paths.length > 1)
    .sort(([a], [b]) => a.localeCompare(b));

  if (duplicates.length === 0) {
    return;
  }

  const rendered = duplicates
    .map(
      ([real, paths]) =>
        `  ${real}\n${paths.map((p) => `    admitted as: ${p}`).join("\n")}`,
    )
    .join("\n");

  throw new Error(
    `[ioc] Composition program admitted ${duplicates.length} physical file(s) more than once:\n${rendered}\n` +
      "Two SourceFiles for one file means two copies of every declaration in it, and a nominal type " +
      "(a class with private or protected members) is not assignable to its own copy — so type " +
      "comparisons over this program would report incompatibilities that no real build has. This is " +
      "an ioc-manifest bug; please report it with this output.",
  );
};

export type CompositionProgramInput = {
  readonly projectRoot: string;
  /**
   * The app's own source files — the same set `ioc generate` roots for discovery. Rooting these
   * is what makes the program the app's build rather than a synthetic one: contract types reach
   * the checker through the app's imports, resolved the way the app resolves them.
   */
  readonly sourceFiles: readonly string[];
  /**
   * Generated registry-types files for every slice (local + composed). Roots because nothing in
   * the app's source necessarily imports a composed package's `ioc-registry.types.ts`, and the
   * comparisons read `IocExternals` / `IocGeneratedCradle` straight out of them.
   */
  readonly typesPaths: readonly string[];
  /**
   * Files whose on-disk content is not the content to judge — the artifacts `ioc generate` is
   * about to write. Keyed by the path they will be written to; the host serves these instead.
   * Generation must judge what it is about to emit, not the previous run's output.
   */
  readonly overlay?: ReadonlyMap<string, string>;
  readonly tsconfig?: IocTsconfigContext;
};

/**
 * A compiler host that serves {@link CompositionProgramInput.overlay} contents in place of disk.
 *
 * Overlaid paths are canonicalised the same way root names are, so an overlay written for
 * `<app>/src/generated/ioc-registry.types.ts` is found however the program reaches that file.
 */
const createOverlayHost = (
  options: ts.CompilerOptions,
  overlay: ReadonlyMap<string, string>,
): ts.CompilerHost => {
  const host = ts.createCompilerHost(options, true);
  if (overlay.size === 0) {
    return host;
  }

  const canonical = new Map<string, string>();
  for (const [filePath, contents] of overlay) {
    canonical.set(canonicalProgramPath(filePath, options), contents);
    canonical.set(path.normalize(filePath), contents);
  }

  const overlaidContents = (fileName: string): string | undefined =>
    canonical.get(path.normalize(fileName)) ??
    canonical.get(canonicalProgramPath(fileName, options));

  const baseGetSourceFile = host.getSourceFile.bind(host);
  const baseReadFile = host.readFile.bind(host);
  const baseFileExists = host.fileExists.bind(host);

  return {
    ...host,
    getSourceFile: (fileName, languageVersion, onError, shouldCreate) => {
      const contents = overlaidContents(fileName);
      if (contents === undefined) {
        return baseGetSourceFile(
          fileName,
          languageVersion,
          onError,
          shouldCreate,
        );
      }
      return ts.createSourceFile(fileName, contents, languageVersion, true);
    },
    readFile: (fileName) => overlaidContents(fileName) ?? baseReadFile(fileName),
    fileExists: (fileName) =>
      overlaidContents(fileName) !== undefined || baseFileExists(fileName),
  };
};

/**
 * Builds the composition program, or returns `undefined` when the workspace tsconfig cannot be
 * read at all.
 *
 * `undefined` is a genuine "no checker available" — the externals check already carries a caveat
 * for it — and is NOT how a duplicate-file violation surfaces: that throws, because a program
 * that quietly doubles a declaration is worse than no program.
 */
export const createCompositionProgram = (
  input: CompositionProgramInput,
): CompositionProgramContext | undefined => {
  if (input.typesPaths.length === 0) {
    return undefined;
  }

  let tsconfig: IocTsconfigContext;
  try {
    tsconfig = input.tsconfig ?? loadIocTsconfigContext(input.projectRoot);
  } catch {
    return undefined;
  }

  const options = readOnlyProgramOptions(tsconfig.options);
  const canonicalPathFor = (filePath: string): string =>
    canonicalProgramPath(filePath, options);

  const rootNames = [
    ...new Set(
      [...input.sourceFiles, ...input.typesPaths].map(canonicalPathFor),
    ),
  ];

  const program = ts.createProgram({
    rootNames,
    options,
    host: createOverlayHost(options, input.overlay ?? new Map()),
  });

  assertNoDuplicateSourceFiles(program);

  return {
    checker: program.getTypeChecker(),
    program,
    customConditions: tsconfig.customConditions,
    canonicalPathFor,
  };
};
