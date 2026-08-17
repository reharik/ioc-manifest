/**
 * @fileoverview Generation-time errors for reference forms that target the generated registry-types
 * file (`ioc-registry.types.ts`) from scanned source but cannot be intercepted by the syntactic
 * deps-resolution machinery: re-exports (`export … from`) and import-type nodes
 * (`typeof import(…)` / `import(…).X`). Both fall through to TypeScript's own module/type
 * resolution, which reads prior generated output — poisoning demand analysis with stale types on a
 * warm run and deadlocking on a cold start where the generated file does not exist yet. Detection
 * here is PURELY SYNTACTIC (source AST + specifier comparison); the generated file is never read or
 * type-checked, and both errors fire identically whether or not it exists on disk.
 */
import path from "node:path";
import ts from "typescript";
import { moduleSpecifierTargetsGeneratedRegistry } from "./generatedRegistrySpecifier.js";

type GeneratedReferencePaths = {
  projectRoot: string;
  generatedDir: string;
};

const relativeSourcePath = (sourceFile: ts.SourceFile, projectRoot: string): string =>
  path.relative(projectRoot, path.resolve(sourceFile.fileName)).replace(/\\/g, "/");

const nodeLine = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

const formatReexportError = (
  sourceFile: ts.SourceFile,
  node: ts.ExportDeclaration,
  projectRoot: string,
): string => {
  const rel = relativeSourcePath(sourceFile, projectRoot);
  return (
    `[ioc] ${rel}:${nodeLine(sourceFile, node)} re-exports from the generated registry file: ` +
    `\`${node.getText(sourceFile)}\`. ` +
    `Re-exported generated names cannot be intercepted syntactically, so consumers of the ` +
    `re-export would force type resolution through prior generated output. ` +
    `Import directly from the generated registry file instead of re-exporting it.`
  );
};

const formatImportTypeError = (
  sourceFile: ts.SourceFile,
  node: ts.ImportTypeNode,
  projectRoot: string,
): string => {
  const rel = relativeSourcePath(sourceFile, projectRoot);
  return (
    `[ioc] ${rel}:${nodeLine(sourceFile, node)} references the generated registry file with an ` +
    `import() type: \`${node.getText(sourceFile)}\`. ` +
    `\`typeof import(…)\` / \`import(…).X\` references cannot be intercepted syntactically, so ` +
    `they force type resolution through prior generated output. ` +
    `Use a regular type import from the generated registry file instead ` +
    `(\`import type { … } from "…/ioc-registry.types.js"\`).`
  );
};

const importTypeSpecifierText = (node: ts.ImportTypeNode): string | undefined => {
  if (
    ts.isLiteralTypeNode(node.argument) &&
    ts.isStringLiteral(node.argument.literal)
  ) {
    return node.argument.literal.text;
  }
  return undefined;
};

const collectGeneratedReferenceErrors = (
  sourceFile: ts.SourceFile,
  paths: GeneratedReferencePaths,
  errors: string[],
): void => {
  const containingAbsPath = path.resolve(sourceFile.fileName);

  const visit = (node: ts.Node): void => {
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      moduleSpecifierTargetsGeneratedRegistry(
        node.moduleSpecifier.text,
        containingAbsPath,
        paths.generatedDir,
      )
    ) {
      errors.push(formatReexportError(sourceFile, node, paths.projectRoot));
    }

    if (ts.isImportTypeNode(node)) {
      const specifier = importTypeSpecifierText(node);
      if (
        specifier !== undefined &&
        moduleSpecifierTargetsGeneratedRegistry(
          specifier,
          containingAbsPath,
          paths.generatedDir,
        )
      ) {
        errors.push(formatImportTypeError(sourceFile, node, paths.projectRoot));
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
};

/**
 * Throws (never warns) when any scanned source file re-exports from the generated registry-types
 * file or references it through an import-type node, aggregating all offenders into one error.
 * Runs before any type-sensitive pass so an offending file fails the run before it can poison
 * demand analysis. Cold-start-safe: detection never touches the generated file itself.
 */
export const validateGeneratedReferencesAtCodegen = (
  files: readonly string[],
  program: ts.Program,
  paths: GeneratedReferencePaths,
): void => {
  const errors: string[] = [];

  for (const file of files) {
    const sourceFile = program.getSourceFile(file);
    if (sourceFile === undefined) {
      continue;
    }
    collectGeneratedReferenceErrors(sourceFile, paths, errors);
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n\n"));
  }
};
