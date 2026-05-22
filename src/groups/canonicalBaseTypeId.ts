/**
 * @fileoverview Opaque canonical identifiers for group base types (§8.1).
 *
 * Format: `<normalized-absolute-declaration-path>:<TypeName>` — internal only; appears in
 * composition errors and `groupBaseTypeAliases` config. Users copy values from errors without
 * needing to understand how paths are chosen.
 */
import path from "node:path";
import ts from "typescript";
import { resolveContractTypeSourceFile } from "../generator/contractTypeSourceFile.js";
import type { ResolvedScanDir } from "../generator/manifestPaths.js";
import {
  resolveDeclaredBaseType,
  type BaseTypeResolution,
} from "./baseTypeAssignability.js";

export type CanonicalBaseTypeIdResolution =
  | { ok: true; baseTypeId: string }
  | { ok: false; message: string };

const getTopLevelTypeDeclaration = (
  sourceFile: ts.SourceFile,
  typeName: string,
): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined => {
  for (const stmt of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === typeName) {
      if (stmt.parent === sourceFile) {
        return stmt;
      }
    }
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === typeName) {
      if (stmt.parent === sourceFile) {
        return stmt;
      }
    }
  }
  return undefined;
};

/** Builds the opaque canonical identifier from a resolved declaration file and type name. */
export const formatCanonicalBaseTypeId = (
  declarationFile: string,
  typeName: string,
): string => `${path.normalize(declarationFile)}:${typeName}`;

const declarationFileFromLocalBaseType = (
  program: ts.Program,
  typeName: string,
): string | undefined => {
  let loneFile: string | undefined;

  for (const sf of program.getSourceFiles()) {
    if (sf.fileName.includes(`${path.sep}node_modules${path.sep}`)) {
      continue;
    }
    const decl = getTopLevelTypeDeclaration(sf, typeName);
    if (decl === undefined) {
      continue;
    }
    const normalized = path.normalize(sf.fileName);
    if (loneFile !== undefined && loneFile !== normalized) {
      return undefined;
    }
    loneFile = normalized;
  }

  return loneFile;
};

const isSourceFileUnderScanRoots = (
  sourceFile: ts.SourceFile,
  scanDirs: readonly ResolvedScanDir[],
): boolean => {
  const normalized = path.normalize(sourceFile.fileName);
  for (const root of scanDirs) {
    const rootNorm = path.normalize(root.absPath);
    if (normalized === rootNorm || normalized.startsWith(`${rootNorm}${path.sep}`)) {
      return true;
    }
  }
  return false;
};

const typeNameFromImportClause = (
  clause: ts.ImportClause,
  typeName: string,
): boolean => {
  if (clause.name?.text === typeName) {
    return true;
  }
  if (
    clause.namedBindings !== undefined &&
    ts.isNamedImports(clause.namedBindings)
  ) {
    return clause.namedBindings.elements.some(
      (el) => el.name.text === typeName,
    );
  }
  return false;
};

const resolveBaseTypeViaScanRootImports = (
  program: ts.Program,
  checker: ts.TypeChecker,
  typeName: string,
  generatedDir: string,
  scanDirs: readonly ResolvedScanDir[],
): string | undefined => {
  const host = ts.createCompilerHost(program.getCompilerOptions());
  const seenDeclarationFiles = new Set<string>();

  for (const sf of program.getSourceFiles()) {
    if (!isSourceFileUnderScanRoots(sf, scanDirs)) {
      continue;
    }

    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || stmt.importClause === undefined) {
        continue;
      }
      if (!typeNameFromImportClause(stmt.importClause, typeName)) {
        continue;
      }
      const specifier = stmt.moduleSpecifier;
      if (!ts.isStringLiteral(specifier)) {
        continue;
      }

      const moduleSpecifier = specifier.text;
      const isRelative =
        moduleSpecifier.startsWith("./") ||
        moduleSpecifier.startsWith("../");

      let resolvedSource: ts.SourceFile | undefined;
      if (isRelative) {
        resolvedSource = resolveContractTypeSourceFile(
          program,
          path.dirname(sf.fileName),
          moduleSpecifier,
          scanDirs,
          typeName,
        );
      } else {
        const resolved = ts.resolveModuleName(
          moduleSpecifier,
          sf.fileName,
          program.getCompilerOptions(),
          host,
        );
        const fileName = resolved.resolvedModule?.resolvedFileName;
        if (fileName !== undefined) {
          resolvedSource = program.getSourceFile(fileName);
        }
      }

      if (resolvedSource === undefined) {
        continue;
      }

      const decl = getTopLevelTypeDeclaration(resolvedSource, typeName);
      if (decl === undefined) {
        const sym = checker.getSymbolAtLocation(stmt.importClause);
        if (sym !== undefined) {
          const aliased = checker.getAliasedSymbol(sym);
          const decls = aliased.getDeclarations();
          if (decls !== undefined && decls.length > 0) {
            seenDeclarationFiles.add(
              path.normalize(decls[0]!.getSourceFile().fileName),
            );
          }
        }
        continue;
      }

      seenDeclarationFiles.add(path.normalize(resolvedSource.fileName));
    }
  }

  if (seenDeclarationFiles.size !== 1) {
    return undefined;
  }

  return [...seenDeclarationFiles][0];
};

export type ResolveCanonicalBaseTypeIdContext = {
  program: ts.Program;
  generatedDir: string;
  scanDirs: readonly ResolvedScanDir[];
};

/**
 * Resolves the canonical base-type identifier for a group `baseType` config name.
 * Prefers a unique local (non–node_modules) declaration; falls back to tracing imports from scan roots.
 */
export const resolveCanonicalBaseTypeId = (
  checker: ts.TypeChecker,
  context: ResolveCanonicalBaseTypeIdContext,
  typeName: string,
): CanonicalBaseTypeIdResolution => {
  const localFile = declarationFileFromLocalBaseType(
    context.program,
    typeName,
  );
  if (localFile !== undefined) {
    return {
      ok: true,
      baseTypeId: formatCanonicalBaseTypeId(localFile, typeName),
    };
  }

  const localResolution = resolveDeclaredBaseType(
    context.program,
    checker,
    typeName,
  );
  if (!localResolution.ok && localResolution.message.includes("ambiguous")) {
    return { ok: false, message: localResolution.message };
  }

  const importFile = resolveBaseTypeViaScanRootImports(
    context.program,
    checker,
    typeName,
    context.generatedDir,
    context.scanDirs,
  );
  if (importFile !== undefined) {
    return {
      ok: true,
      baseTypeId: formatCanonicalBaseTypeId(importFile, typeName),
    };
  }

  if (!localResolution.ok) {
    return { ok: false, message: localResolution.message };
  }

  const fallbackFile = declarationFileFromLocalBaseType(
    context.program,
    typeName,
  );
  if (fallbackFile !== undefined) {
    return {
      ok: true,
      baseTypeId: formatCanonicalBaseTypeId(fallbackFile, typeName),
    };
  }

  return {
    ok: false,
    message: `no declaration file found for base type ${JSON.stringify(typeName)}`,
  };
};

/** Re-export for callers that need assignability after id resolution. */
export const resolveDeclaredBaseTypeForGroup = (
  program: ts.Program,
  checker: ts.TypeChecker,
  typeName: string,
): BaseTypeResolution =>
  resolveDeclaredBaseType(program, checker, typeName);
