import ts from "typescript";
import {
  computeManifestModuleSpecifier,
  type FactoryDiscoveryPaths,
} from "../manifestPaths.js";
import { cradleTypeImportUsesDefaultExport } from "../contractTypeSourceFile.js";
import type { EmittedTypeReference } from "./types.js";

const intrinsicNames = new Set([
  "string",
  "number",
  "boolean",
  "void",
  "undefined",
  "null",
  "never",
  "unknown",
  "any",
  "bigint",
  "symbol",
]);

const unwrapPromiseType = (checker: ts.TypeChecker, t: ts.Type): ts.Type => {
  const sym = t.getSymbol();
  const symName = sym?.getName();
  if (symName === "Promise") {
    const args = checker.getTypeArguments(t as ts.TypeReference);
    if (args.length > 0) {
      return unwrapPromiseType(checker, args[0]);
    }
  }
  return t;
};

const walkToImportDeclaration = (
  decl: ts.Node,
): ts.ImportDeclaration | undefined => {
  let node: ts.Node | undefined = decl;
  while (node !== undefined) {
    if (ts.isImportDeclaration(node)) {
      return node;
    }
    node = node.parent;
  }
  return undefined;
};

const tryRecoverPreferredModuleSpecifier = (
  checker: ts.TypeChecker,
  type: ts.Type,
  contextSourceFile: ts.SourceFile,
): string | undefined => {
  const t0 = unwrapPromiseType(checker, type);
  const t = checker.getApparentType(t0);

  if (t.isUnion()) {
    return undefined;
  }

  const trySymbol = (sym: ts.Symbol | undefined): string | undefined => {
    if (sym === undefined) {
      return undefined;
    }
    const decls = sym.declarations ?? [];
    for (const decl of decls) {
      if (decl.getSourceFile() !== contextSourceFile) {
        continue;
      }
      const imp = walkToImportDeclaration(decl);
      if (imp !== undefined && ts.isStringLiteralLike(imp.moduleSpecifier)) {
        return imp.moduleSpecifier.text;
      }
    }
    return undefined;
  };

  const fromAlias = trySymbol(t.aliasSymbol);
  if (fromAlias !== undefined) {
    return fromAlias;
  }
  const sym = t.getSymbol();
  const fromSym = trySymbol(sym);
  if (fromSym !== undefined) {
    return fromSym;
  }
  if (sym !== undefined && sym.flags & ts.SymbolFlags.Alias) {
    const aliased = checker.getAliasedSymbol(sym);
    return trySymbol(aliased);
  }
  return undefined;
};

const typeNameFromSymbol = (
  checker: ts.TypeChecker,
  type: ts.Type,
): string | undefined => {
  const t0 = unwrapPromiseType(checker, type);
  const t = checker.getApparentType(t0);

  if (t.isUnion()) {
    return undefined;
  }

  const symbol = t.aliasSymbol ?? t.getSymbol();
  if (!symbol) {
    return undefined;
  }

  const name = symbol.getName();
  if (!name || intrinsicNames.has(name)) {
    return undefined;
  }

  return name;
};

const getTypeDeclarationSourceFile = (
  checker: ts.TypeChecker,
  type: ts.Type,
): ts.SourceFile | undefined => {
  const t0 = unwrapPromiseType(checker, type);
  const t = checker.getApparentType(t0);

  if (t.isUnion()) {
    return undefined;
  }

  let symbol = t.aliasSymbol ?? t.getSymbol();
  if (!symbol) {
    return undefined;
  }

  if (symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }

  const decl = symbol.declarations?.[0];
  if (!decl) {
    return undefined;
  }

  return decl.getSourceFile();
};

export type EmitTypeReferenceContext = FactoryDiscoveryPaths & {
  program: ts.Program;
  projectRoot: string;
  contextSourceFile: ts.SourceFile;
};

/**
 * Maps a TypeScript type to an importable type name and module specifier for generated registry types.
 */
export const emitTypeReference = (
  checker: ts.TypeChecker,
  type: ts.Type,
  ctx: EmitTypeReferenceContext,
): EmittedTypeReference | undefined => {
  const typeName = typeNameFromSymbol(checker, type);
  if (typeName === undefined) {
    return undefined;
  }

  const declSource = getTypeDeclarationSourceFile(checker, type);
  if (declSource === undefined) {
    return undefined;
  }

  const relImport = computeManifestModuleSpecifier(
    declSource.fileName,
    ctx.generatedDir,
    ctx.scanDirs,
    {
      preferredModuleSpecifier: tryRecoverPreferredModuleSpecifier(
        checker,
        type,
        ctx.contextSourceFile,
      ),
      projectRoot: ctx.projectRoot,
    },
  );

  const useDefaultImport =
    cradleTypeImportUsesDefaultExport(declSource, typeName) ?? false;

  return { typeName, relImport, useDefaultImport };
};
