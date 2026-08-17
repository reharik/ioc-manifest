/**
 * @fileoverview Generation-time rejection of every reference form that targets the generated
 * registry-types file (`ioc-registry.types.ts`) from scanned source and cannot be resolved by the
 * syntactic deps-resolution machinery. The classification — which forms are resolved, which are
 * merely printed back by name, and which are rejected here — lives in one place,
 * {@link GENERATED_REFERENCE_FORMS}; this file only detects and reports.
 *
 * Two categories are rejected:
 *
 *   - MODULE LINKAGE that cannot be intercepted at all: re-exports (`export … from`), import-type
 *     nodes (`typeof import(…)` / `import(…).X`), default imports, `import … = require(…)`,
 *     `export =`, and `/// <reference path=… />` directives.
 *   - USES of an otherwise-supported binding that read INTO a generated type rather than naming
 *     it: `keyof`, `typeof`, chained or computed indexed access, indexing through a
 *     type-argument-bearing reference, indexing anything but `IocGeneratedCradle`, and heritage
 *     clauses.
 *
 * Naming a generated type (`createContainer<IocGeneratedCradle>()`) stays legal here — it is the
 * documented composition-root pattern and prints straight back. It is rejected only where printing
 * back is not enough, by the deps-position backstop in `analyzeDemandSupply`.
 *
 * Detection is PURELY SYNTACTIC (source AST + specifier comparison); the generated file is never
 * read or type-checked, and every error fires identically whether or not it exists on disk.
 */
import path from "node:path";
import ts from "typescript";
import {
  collectGeneratedBindingUses,
  collectGeneratedRegistryBindings,
} from "./generatedRegistryBindings.js";
import {
  formatRejectedGeneratedReference,
  isRejectedGeneratedReferenceForm,
} from "./generatedReferenceForms.js";
import {
  moduleSpecifierBasenameStem,
  moduleSpecifierTargetsGeneratedRegistry,
  REGISTRY_TYPES_BASENAME_STEM,
} from "./generatedRegistrySpecifier.js";

type GeneratedReferencePaths = {
  projectRoot: string;
  generatedDir: string;
};

const relativeSourcePath = (sourceFile: ts.SourceFile, projectRoot: string): string =>
  path.relative(projectRoot, path.resolve(sourceFile.fileName)).replace(/\\/g, "/");

const locationAt = (
  sourceFile: ts.SourceFile,
  projectRoot: string,
  pos: number,
): string => {
  const { line } = sourceFile.getLineAndCharacterOfPosition(pos);
  return `${relativeSourcePath(sourceFile, projectRoot)}:${line + 1}`;
};

const nodeLocation = (
  sourceFile: ts.SourceFile,
  projectRoot: string,
  node: ts.Node,
): string => locationAt(sourceFile, projectRoot, node.getStart(sourceFile));

/** Which re-export form an `export … from "…"` declaration is. */
const reexportFormId = (node: ts.ExportDeclaration): string => {
  const clause = node.exportClause;
  if (clause === undefined) {
    return "reexportStar";
  }
  if (ts.isNamespaceExport(clause)) {
    return "reexportStarAsNamespace";
  }
  return node.isTypeOnly ? "reexportTypeNamed" : "reexportNamed";
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

/**
 * `/// <reference path="…" />` directives naming the generated file. Matched on the basename stem
 * alone, like every other specifier comparison here, so the path need not resolve.
 */
const collectReferenceDirectiveErrors = (
  sourceFile: ts.SourceFile,
  projectRoot: string,
  errors: string[],
): void => {
  for (const ref of sourceFile.referencedFiles) {
    if (moduleSpecifierBasenameStem(ref.fileName) !== REGISTRY_TYPES_BASENAME_STEM) {
      continue;
    }
    // `ref.pos`/`ref.end` span only the quoted path; quote the whole directive line so the error
    // shows the form the user wrote.
    const { line } = sourceFile.getLineAndCharacterOfPosition(ref.pos);
    const lineStart = sourceFile.getLineStarts()[line] ?? ref.pos;
    const lineEnd = sourceFile.text.indexOf("\n", ref.end);
    errors.push(
      formatRejectedGeneratedReference(
        "tripleSlashReference",
        locationAt(sourceFile, projectRoot, ref.pos),
        sourceFile.text
          .slice(lineStart, lineEnd === -1 ? sourceFile.text.length : lineEnd)
          .trim(),
      ),
    );
  }
};

const collectModuleLinkageErrors = (
  sourceFile: ts.SourceFile,
  containingAbsPath: string,
  paths: GeneratedReferencePaths,
  errors: string[],
): void => {
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
      errors.push(
        formatRejectedGeneratedReference(
          reexportFormId(node),
          nodeLocation(sourceFile, paths.projectRoot, node),
          node.getText(sourceFile),
        ),
      );
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
        errors.push(
          formatRejectedGeneratedReference(
            node.isTypeOf ? "typeofImportType" : "importTypeNode",
            nodeLocation(sourceFile, paths.projectRoot, node),
            node.getText(sourceFile),
          ),
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
};

const collectGeneratedReferenceErrors = (
  sourceFile: ts.SourceFile,
  paths: GeneratedReferencePaths,
  errors: string[],
): void => {
  const containingAbsPath = path.resolve(sourceFile.fileName);

  collectModuleLinkageErrors(sourceFile, containingAbsPath, paths, errors);
  collectReferenceDirectiveErrors(sourceFile, paths.projectRoot, errors);

  const bindings = collectGeneratedRegistryBindings(
    sourceFile,
    containingAbsPath,
    paths.generatedDir,
  );

  // A binding form that can never be claimed is reported once, at the import, rather than at each
  // of its uses — the import is what has to change.
  for (const binding of bindings.values()) {
    const formId =
      binding.kind === "default"
        ? "defaultImport"
        : binding.kind === "importEquals"
          ? "importEqualsRequire"
          : undefined;
    if (formId !== undefined) {
      errors.push(
        formatRejectedGeneratedReference(
          formId,
          nodeLocation(sourceFile, paths.projectRoot, binding.node),
          binding.node.getText(sourceFile),
        ),
      );
    }
  }

  for (const use of collectGeneratedBindingUses(sourceFile, bindings)) {
    // Uses of an already-rejected binding add nothing: the import is the thing to fix.
    if (
      use.reference.binding.kind === "default" ||
      use.reference.binding.kind === "importEquals"
    ) {
      continue;
    }
    if (!isRejectedGeneratedReferenceForm(use.formId)) {
      continue;
    }
    errors.push(
      formatRejectedGeneratedReference(
        use.formId,
        nodeLocation(sourceFile, paths.projectRoot, use.node),
        use.node.getText(sourceFile),
      ),
    );
  }
};

/**
 * Throws (never warns) when any scanned source file references the generated registry-types file
 * through a form that generation cannot resolve syntactically, aggregating all offenders into one
 * error. Runs before any type-sensitive pass so an offending file fails the run before it can
 * poison demand analysis. Cold-start-safe: detection never touches the generated file itself.
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
