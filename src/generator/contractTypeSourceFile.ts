import path from "node:path";
import ts from "typescript";
import {
  registryTypesFilePath,
  type ResolvedScanDir,
} from "./manifestPaths.js";

const matchSourceFileByAbsoluteBase = (
  program: ts.Program,
  baseAbs: string,
): ts.SourceFile | undefined => {
  const candidates = [
    `${baseAbs}.ts`,
    `${baseAbs}.tsx`,
    path.join(baseAbs, "index.ts"),
    path.join(baseAbs, "index.tsx"),
  ];
  const normalizedCandidates = candidates.map((c) => path.normalize(c));
  const files = program.getSourceFiles();
  for (const cand of normalizedCandidates) {
    const hit = files.find((sf) => path.normalize(sf.fileName) === cand);
    if (hit !== undefined) {
      return hit;
    }
  }
  const lower = new Set(normalizedCandidates.map((c) => c.toLowerCase()));
  const caseHit = files.find((sf) =>
    lower.has(path.normalize(sf.fileName).toLowerCase()),
  );
  if (caseHit !== undefined) {
    return caseHit;
  }
  return undefined;
};

/**
 * Locates the source file for a contract type import path as stored on registration plans:
 * relative to {@link generatedDir}, or a bare npm package specifier resolved via the program.
 */
export const resolveContractTypeSourceFile = (
  program: ts.Program,
  generatedDir: string,
  contractTypeRelImport: string,
  _scanDirs?: readonly ResolvedScanDir[],
  _contractName?: string,
): ts.SourceFile | undefined => {
  const isRelativeSpecifier =
    contractTypeRelImport.startsWith("./") ||
    contractTypeRelImport.startsWith("../");

  if (isRelativeSpecifier) {
    const raw = contractTypeRelImport.replace(/^\.\//, "").replace(/\.js$/i, "");
    const baseAbs = path.resolve(generatedDir, raw);
    return matchSourceFileByAbsoluteBase(program, baseAbs);
  }

  const bareResolved = tryResolveBarePackageSpecifierToSourceFile(
    program,
    contractTypeRelImport,
    generatedDir,
  );
  if (bareResolved !== undefined) {
    return bareResolved;
  }

  return undefined;
};

const looksLikeBarePackageSpecifier = (spec: string): boolean => {
  const s = spec.replace(/\.js$/i, "");
  if (s.length === 0) {
    return false;
  }
  if (s.startsWith(".") || s.startsWith("/")) {
    return false;
  }
  if (path.isAbsolute(s)) {
    return false;
  }
  if (s.includes("node_modules")) {
    return false;
  }
  return true;
};

/**
 * Resolves a stored bare package specifier (e.g. `knex`, `@scope/pkg`) to a program source file
 * so default-vs-named import emission can inspect the declaration module.
 */
const tryResolveBarePackageSpecifierToSourceFile = (
  program: ts.Program,
  moduleSpecifier: string,
  generatedDir: string,
): ts.SourceFile | undefined => {
  const trimmed = moduleSpecifier.replace(/\.js$/i, "");
  if (!looksLikeBarePackageSpecifier(trimmed)) {
    return undefined;
  }
  const containingFile = registryTypesFilePath(generatedDir);
  const host = ts.createCompilerHost(program.getCompilerOptions());
  const resolved = ts.resolveModuleName(
    trimmed,
    containingFile,
    program.getCompilerOptions(),
    host,
  );
  const fileName = resolved.resolvedModule?.resolvedFileName;
  if (fileName === undefined) {
    return undefined;
  }
  return program.getSourceFile(fileName);
};

const hasExplicitNamedExportOfContract = (
  sourceFile: ts.SourceFile,
  contractName: string,
): boolean => {
  for (const stmt of sourceFile.statements) {
    if (ts.isExportDeclaration(stmt) && stmt.exportClause !== undefined) {
      if (ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          if (el.name.text === contractName) {
            return true;
          }
        }
      }
    }
    if (ts.isClassDeclaration(stmt) && stmt.name?.text === contractName) {
      const hasExport = stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      const hasDefault = stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.DefaultKeyword,
      );
      if (hasExport === true && hasDefault !== true) {
        return true;
      }
    }
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === contractName) {
      if (
        stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ===
        true
      ) {
        return true;
      }
    }
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === contractName) {
      if (
        stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ===
        true
      ) {
        return true;
      }
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === contractName) {
      const hasExport = stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      const hasDefault = stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.DefaultKeyword,
      );
      if (hasExport === true && hasDefault !== true) {
        return true;
      }
    }
  }
  return false;
};

const defaultExportProvidesContract = (
  sourceFile: ts.SourceFile,
  contractName: string,
): boolean => {
  for (const stmt of sourceFile.statements) {
    if (ts.isClassDeclaration(stmt) && stmt.name?.text === contractName) {
      const hasExport = stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      const hasDefault = stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.DefaultKeyword,
      );
      if (hasExport === true && hasDefault === true) {
        return true;
      }
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === contractName) {
      const hasExport = stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      const hasDefault = stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.DefaultKeyword,
      );
      if (hasExport === true && hasDefault === true) {
        return true;
      }
    }
    if (
      ts.isExportAssignment(stmt) &&
      ts.isIdentifier(stmt.expression) &&
      stmt.expression.text === contractName
    ) {
      return true;
    }
  }
  return false;
};

/**
 * True when {@link contractName} is provided only via the module's default export (including
 * `export default class Name`, `export default Name`, or `export = Name`), and not via a separate
 * named export `{ contractName }`. Then `ioc-registry.types.ts` must use
 * `import type Name from "..."` instead of `import type { Name } from "..."`.
 */
export const cradleTypeImportUsesDefaultExport = (
  sourceFile: ts.SourceFile,
  contractName: string,
): boolean => {
  if (hasExplicitNamedExportOfContract(sourceFile, contractName)) {
    return false;
  }
  return defaultExportProvidesContract(sourceFile, contractName);
};
