import path from "node:path";
import ts from "typescript";

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

const resolveSymbolIdentity = (
  checker: ts.TypeChecker,
  sym: ts.Symbol,
): ts.Symbol =>
  (sym.flags & ts.SymbolFlags.Alias) !== 0
    ? checker.getAliasedSymbol(sym)
    : sym;

const symbolsMatch = (
  checker: ts.TypeChecker,
  a: ts.Symbol,
  b: ts.Symbol,
): boolean =>
  resolveSymbolIdentity(checker, a) === resolveSymbolIdentity(checker, b);

const isBareModuleSpecifier = (text: string): boolean => {
  if (text.length === 0) {
    return false;
  }
  if (text.startsWith(".") || text.startsWith("/")) {
    return false;
  }
  if (path.isAbsolute(text)) {
    return false;
  }
  if (text.includes("node_modules")) {
    return false;
  }
  return true;
};

const resolveTypeSymbol = (
  checker: ts.TypeChecker,
  type: ts.Type,
): ts.Symbol | undefined => {
  const t = checker.getApparentType(type);
  if (t.isUnion() || t.isIntersection()) {
    return undefined;
  }
  const sym = t.aliasSymbol ?? t.getSymbol();
  if (sym === undefined) {
    return undefined;
  }
  return resolveSymbolIdentity(checker, sym);
};

const recoverFromSameFileImport = (
  checker: ts.TypeChecker,
  sym: ts.Symbol | undefined,
  factorySourceFile: ts.SourceFile,
): string | undefined => {
  if (sym === undefined) {
    return undefined;
  }
  const decls = sym.declarations ?? [];
  for (const decl of decls) {
    if (decl.getSourceFile() !== factorySourceFile) {
      continue;
    }
    const imp = walkToImportDeclaration(decl);
    if (imp !== undefined && ts.isStringLiteralLike(imp.moduleSpecifier)) {
      return imp.moduleSpecifier.text;
    }
  }
  return undefined;
};

const recoverFromFactoryBareImports = (
  checker: ts.TypeChecker,
  targetSymbol: ts.Symbol,
  factorySourceFile: ts.SourceFile,
): string | undefined => {
  for (const stmt of factorySourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) {
      continue;
    }
    const spec = stmt.moduleSpecifier;
    if (!ts.isStringLiteralLike(spec) || !isBareModuleSpecifier(spec.text)) {
      continue;
    }
    const clause = stmt.importClause;
    if (clause === undefined) {
      continue;
    }

    if (clause.namedBindings !== undefined) {
      if (ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          const bindingSym = checker.getSymbolAtLocation(el.name);
          if (
            bindingSym !== undefined &&
            symbolsMatch(checker, bindingSym, targetSymbol)
          ) {
            return spec.text;
          }
        }
      }
      continue;
    }

    if (clause.name !== undefined) {
      const bindingSym = checker.getSymbolAtLocation(clause.name);
      if (
        bindingSym !== undefined &&
        symbolsMatch(checker, bindingSym, targetSymbol)
      ) {
        return spec.text;
      }
    }
  }
  return undefined;
};

/**
 * Recovers the module specifier a factory already uses for a type: same-file import re-exports,
 * then any bare-specifier import in the factory file that resolves to the same symbol.
 */
export const tryRecoverPreferredModuleSpecifier = (
  checker: ts.TypeChecker,
  type: ts.Type,
  factorySourceFile: ts.SourceFile,
): string | undefined => {
  const t = checker.getApparentType(type);
  if (t.isUnion() || t.isIntersection()) {
    return undefined;
  }

  const trySymbol = (sym: ts.Symbol | undefined): string | undefined =>
    recoverFromSameFileImport(checker, sym, factorySourceFile);

  const fromAlias = trySymbol(t.aliasSymbol);
  if (fromAlias !== undefined) {
    return fromAlias;
  }
  const sym = t.getSymbol();
  const fromSym = trySymbol(sym);
  if (fromSym !== undefined) {
    return fromSym;
  }
  if (sym !== undefined && (sym.flags & ts.SymbolFlags.Alias) !== 0) {
    const aliased = checker.getAliasedSymbol(sym);
    const fromAliased = trySymbol(aliased);
    if (fromAliased !== undefined) {
      return fromAliased;
    }
  }

  const typeSymbol = resolveTypeSymbol(checker, type);
  if (typeSymbol === undefined) {
    return undefined;
  }
  return recoverFromFactoryBareImports(
    checker,
    typeSymbol,
    factorySourceFile,
  );
};
