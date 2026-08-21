/**
 * @fileoverview Compiles emitted registry-types text with a real TypeScript program.
 *
 * String matching proves the emitter printed what we expected; it cannot prove the consumer's
 * `tsc` will accept it. The gap between those two is exactly how a non-compiling
 * `ioc-registry.types.ts` reached a consumer: every assertion about the emitted text passed while
 * the text itself failed to resolve six imports and eight bare names.
 *
 * The source is overlaid onto a compiler host at the path it WOULD be written to, so relative
 * specifiers and `node_modules` resolution behave exactly as they would on disk, and no file is
 * actually written.
 */
import assert from "node:assert";
import path from "node:path";
import ts from "typescript";

const DEFAULT_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
};

export type CompileGeneratedSourceResult = {
  diagnostics: readonly ts.Diagnostic[];
  formatted: string;
};

/** Type-checks {@link source} as if it were written to {@link filePath}. */
export const compileGeneratedSource = (
  source: string,
  filePath: string,
  extraOptions?: ts.CompilerOptions,
): CompileGeneratedSourceResult => {
  const options = { ...DEFAULT_OPTIONS, ...extraOptions };
  const host = ts.createCompilerHost(options, true);
  const target = path.normalize(filePath);
  const isTarget = (fileName: string): boolean =>
    path.normalize(fileName) === target;

  const baseGetSourceFile = host.getSourceFile.bind(host);
  const baseFileExists = host.fileExists.bind(host);
  const baseReadFile = host.readFile.bind(host);

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
    isTarget(fileName)
      ? ts.createSourceFile(fileName, source, languageVersion, true, ts.ScriptKind.TS)
      : baseGetSourceFile(fileName, languageVersion, onError, shouldCreate);
  host.fileExists = (fileName) => isTarget(fileName) || baseFileExists(fileName);
  host.readFile = (fileName) =>
    isTarget(fileName) ? source : baseReadFile(fileName);

  const program = ts.createProgram({
    rootNames: [filePath],
    options,
    host,
  });
  const diagnostics = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ];

  return {
    diagnostics,
    formatted: ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => path.dirname(filePath),
      getNewLine: () => "\n",
    }),
  };
};

/** Asserts the emitted source type-checks clean at {@link filePath}. */
export const assertGeneratedSourceCompiles = (
  source: string,
  filePath: string,
  extraOptions?: ts.CompilerOptions,
): void => {
  const { diagnostics, formatted } = compileGeneratedSource(
    source,
    filePath,
    extraOptions,
  );
  assert.strictEqual(
    diagnostics.length,
    0,
    `emitted source does not compile:\n${formatted}\n--- source ---\n${source}`,
  );
};
