/**
 * @fileoverview Opaque canonical identifiers for group base types (§8.1).
 *
 * Format (schema v3): `<packageName>/<path within that package>:<TypeName>` — e.g.
 * `@acme/contracts/src/types/Storage.ts:Storage`. Internal only; appears in composition errors and
 * `groupBaseTypeAliases` config, where users copy values from errors without needing to understand
 * how they are chosen. Schema v2 used the absolute declaration path, which made generated output
 * machine-specific; see {@link packageRelativeDeclarationPath}.
 *
 * The absolute declaration path is still needed to load the type back out of the program, so it
 * travels alongside the id inside the generator rather than being parsed out of it.
 */
import path from "node:path";
import ts from "typescript";
import { resolveContractTypeSourceFile } from "../generator/contractTypeSourceFile.js";
import type { ResolvedScanDir } from "../generator/manifestPaths.js";
import { packageRelativeDeclarationPath } from "./packageRelativeDeclarationPath.js";
import {
  resolveDeclaredBaseType,
  type BaseTypeResolution,
} from "./baseTypeAssignability.js";

export type CanonicalBaseTypeIdResolution =
  | {
      ok: true;
      /** Package-relative, machine-independent id emitted into the manifest. */
      baseTypeId: string;
      /** Absolute path of the declaring file (generator-internal; never emitted). */
      declarationFile: string;
    }
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

/**
 * Builds the opaque canonical identifier from a resolved declaration file and type name.
 * The path component is package-relative, so the value is stable across machines and checkouts.
 */
export const formatCanonicalBaseTypeId = (
  declarationFile: string,
  typeName: string,
): string => `${packageRelativeDeclarationPath(declarationFile)}:${typeName}`;

const okResolution = (
  declarationFile: string,
  typeName: string,
): CanonicalBaseTypeIdResolution => ({
  ok: true,
  baseTypeId: formatCanonicalBaseTypeId(declarationFile, typeName),
  declarationFile: path.normalize(declarationFile),
});

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
    return okResolution(localFile, typeName);
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
    context.scanDirs,
  );
  if (importFile !== undefined) {
    return okResolution(importFile, typeName);
  }

  if (!localResolution.ok) {
    return { ok: false, message: localResolution.message };
  }

  const fallbackFile = declarationFileFromLocalBaseType(
    context.program,
    typeName,
  );
  if (fallbackFile !== undefined) {
    return okResolution(fallbackFile, typeName);
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

/**
 * Loads the `ts.Type` for a resolved base type from its ABSOLUTE declaration path (e.g. when the
 * declaration lives under `node_modules` and `resolveDeclaredBaseType` cannot see it).
 *
 * Takes the path and type name directly rather than parsing them back out of the canonical id:
 * since schema v3 that id is package-relative and no longer addresses a file on this machine.
 */
export const resolveBaseTypeFromDeclarationFile = (
  program: ts.Program,
  checker: ts.TypeChecker,
  declarationFile: string,
  typeName: string,
): BaseTypeResolution => {
  const sf = program.getSourceFile(declarationFile);
  if (sf === undefined) {
    return {
      ok: false,
      message: `declaration file ${JSON.stringify(declarationFile)} is not in the TypeScript program`,
    };
  }

  const decl = getTopLevelTypeDeclaration(sf, typeName);
  if (decl === undefined) {
    return {
      ok: false,
      message: `no interface or type alias ${JSON.stringify(typeName)} in ${JSON.stringify(declarationFile)}`,
    };
  }

  const sym = checker.getSymbolAtLocation(decl.name);
  if (sym === undefined) {
    return { ok: false, message: "internal error resolving base type symbol" };
  }

  return { ok: true, type: checker.getDeclaredTypeOfSymbol(sym) };
};
