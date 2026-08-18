/**
 * @fileoverview The declared contract site, shared by both registration unit kinds.
 *
 * v3 identity rule: a unit's contract is read from a *declared, syntactic* site — the factory's
 * return type annotation, or the class's `implements` clause. Both are `ts.TypeNode`s
 * (`ExpressionWithTypeArguments` in a heritage clause extends `TypeNode`), so one resolver serves
 * both positions and every downstream layer sees the same (declaration file, declared name) pair.
 *
 * The checker participates only as a declaration locator; no type normalization takes part in
 * identity.
 */
import ts from "typescript";

/**
 * One registration unit's declaration, as found in a scanned file.
 *
 * `factory`: the function whose return annotation is the contract site.
 * `class`: the class declaration whose `implements` clause is the contract site.
 */
export type DiscoveredUnitDecl =
  | { unitKind: "factory"; decl: ts.FunctionLike }
  | {
      unitKind: "class";
      decl: ts.ClassDeclaration;
      /** Every `implements` entry, in source order (>1 needs disambiguation at scan time). */
      implementsTypes: readonly ts.ExpressionWithTypeArguments[];
    };

/** The AST node a unit is reported at (diagnostics, line numbers). */
export const unitDeclNode = (unit: DiscoveredUnitDecl): ts.Node => unit.decl;

/**
 * The declared contract site type node: return annotation for factories, the `implements` entry
 * for classes. Undefined when the site is absent (unannotated factory, class with no `implements`).
 *
 * A class with several `implements` entries is only ever accepted once discovery has picked one
 * (via `classes[Class].contract`); downstream callers re-select by the already-resolved
 * `contractName` rather than re-reading config, so identity is decided in exactly one place.
 */
export const unitContractSiteTypeNode = (
  checker: ts.TypeChecker,
  unit: DiscoveredUnitDecl,
  contractName?: string,
): ts.TypeNode | undefined => {
  if (unit.unitKind === "factory") {
    return unit.decl.type;
  }
  if (unit.implementsTypes.length === 1) {
    return unit.implementsTypes[0];
  }
  if (contractName === undefined) {
    return undefined;
  }
  return unit.implementsTypes.find((candidate) => {
    const resolution = resolveAnnotationContract(checker, candidate);
    return (
      resolution.kind === "resolved" && resolution.contractName === contractName
    );
  });
};

/**
 * The signature declaration whose first parameter carries this unit's dependencies: the factory
 * function itself, or the class constructor. Undefined for a class with no constructor (no deps).
 *
 * A `ts.ConstructorDeclaration` is a `ts.FunctionLike`, so every deps-analysis path
 * (`validateNamedDepsType`, `inferFactoryDependencies`, `getSignatureFromDeclaration`) works
 * unchanged on both kinds.
 */
export const unitDepsSignatureDecl = (
  unit: DiscoveredUnitDecl,
): ts.FunctionLike | undefined => {
  if (unit.unitKind === "factory") {
    return unit.decl;
  }
  return findClassConstructor(unit.decl);
};

/** Implementation constructor (preferred) or the sole overload signature. */
export const findClassConstructor = (
  classDecl: ts.ClassDeclaration,
): ts.ConstructorDeclaration | undefined => {
  let firstSeen: ts.ConstructorDeclaration | undefined;
  for (const member of classDecl.members) {
    if (!ts.isConstructorDeclaration(member)) {
      continue;
    }
    firstSeen ??= member;
    if (member.body !== undefined) {
      return member;
    }
  }
  return firstSeen;
};

/** The `implements` heritage entries of a class declaration (empty when there is no clause). */
export const classImplementsTypes = (
  classDecl: ts.ClassDeclaration,
): readonly ts.ExpressionWithTypeArguments[] => {
  for (const clause of classDecl.heritageClauses ?? []) {
    if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
      return clause.types;
    }
  }
  return [];
};

export const isAbstractClassDeclaration = (
  classDecl: ts.ClassDeclaration,
): boolean =>
  (ts.getModifiers(classDecl) ?? []).some(
    (m) => m.kind === ts.SyntaxKind.AbstractKeyword,
  );

/** The `extends` heritage entry of a class declaration (a class has at most one). */
export const classExtendsType = (
  classDecl: ts.ClassDeclaration,
): ts.ExpressionWithTypeArguments | undefined => {
  for (const clause of classDecl.heritageClauses ?? []) {
    if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
      return clause.types[0];
    }
  }
  return undefined;
};

/**
 * Resolves an `extends` heritage entry to the class declaration it names, following import aliases
 * with the same checker-as-declaration-locator machinery contract sites use.
 */
const resolveBaseClassDeclaration = (
  checker: ts.TypeChecker,
  heritage: ts.ExpressionWithTypeArguments,
): ts.ClassDeclaration | undefined => {
  const leftmost = leftmostIdentifier(heritage.expression);
  if (leftmost === undefined) {
    return undefined;
  }

  let symbol =
    checker.getSymbolAtLocation(heritage.expression) ??
    checker.getSymbolAtLocation(leftmost);
  if (symbol === undefined) {
    return undefined;
  }

  while ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    const aliased = checker.getAliasedSymbol(symbol);
    if (aliased === symbol) {
      break;
    }
    symbol = aliased;
  }

  return symbol.declarations?.find(ts.isClassDeclaration);
};

/** A concrete class's inherited-but-undeclared contract, as reported by discovery diagnostics. */
export type InheritedContractSite = {
  /** The base named in this class's own `extends` clause, as written. */
  immediateBaseName: string;
  /** Nearest ancestor up the chain that declares `implements` — often the immediate base. */
  ancestorClassName: string;
  /** The single contract that ancestor declares. */
  contractName: string;
};

/** Cycle guard is by visited set; this only bounds pathological synthetic chains. */
const MAX_EXTENDS_CHAIN_DEPTH = 32;

/**
 * Walks a class's `extends` chain to the nearest ancestor carrying an `implements` clause.
 *
 * **Diagnostics only — this walk never registers anything.** Registration is triggered by the
 * `implements` clause a class declares *itself*; inheriting a contract does not inherit
 * registration, by decision. The trigger stays local and explicit so that whether a class is a
 * registration unit is readable at the class, without following a heritage chain into other files.
 * This walk exists purely so that `class Archive extends StorageBase {}`, where `StorageBase`
 * declares `implements MediaStorage`, reports the near-miss instead of vanishing silently.
 *
 * Returns undefined when the chain has no `implements`-bearing ancestor, when the chain cannot be
 * resolved syntactically, or when the ancestor declares more than one contract — a base declaring
 * two contracts is outside the one-contract-per-unit model, and there is no single contract to tell
 * the user to restate.
 */
export const nearestImplementsBearingAncestor = (
  checker: ts.TypeChecker,
  classDecl: ts.ClassDeclaration,
): InheritedContractSite | undefined => {
  const firstBase = classExtendsType(classDecl);
  if (firstBase === undefined) {
    return undefined;
  }
  const immediateBaseName = firstBase.expression.getText();

  const visited = new Set<ts.ClassDeclaration>();
  let heritage: ts.ExpressionWithTypeArguments | undefined = firstBase;

  for (
    let depth = 0;
    heritage !== undefined && depth < MAX_EXTENDS_CHAIN_DEPTH;
    depth += 1
  ) {
    const baseDecl = resolveBaseClassDeclaration(checker, heritage);
    if (baseDecl === undefined || visited.has(baseDecl)) {
      return undefined;
    }
    visited.add(baseDecl);

    const implementsTypes = classImplementsTypes(baseDecl);
    if (implementsTypes.length === 1) {
      const resolution = resolveAnnotationContract(checker, implementsTypes[0]!);
      const contractName =
        resolution.kind === "resolved"
          ? resolution.contractName
          : resolution.kind === "unresolved"
            ? resolution.writtenName
            : undefined;
      if (contractName === undefined) {
        return undefined;
      }
      return {
        immediateBaseName,
        ancestorClassName: baseDecl.name?.text ?? immediateBaseName,
        contractName,
      };
    }
    if (implementsTypes.length > 1) {
      return undefined;
    }

    heritage = classExtendsType(baseDecl);
  }

  return undefined;
};

/**
 * Syntactically unwraps a factory return annotation to the contract reference: strips
 * parentheses and `Promise<T>` wrappers (by written name, no checker). The result is what the
 * author wrote — type-level aliases are never followed. A class `implements` entry passes through
 * unchanged (neither wrapper is legal there).
 */
export const unwrapReturnTypeAnnotation = (node: ts.TypeNode): ts.TypeNode => {
  if (ts.isParenthesizedTypeNode(node)) {
    return unwrapReturnTypeAnnotation(node.type);
  }
  if (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === "Promise" &&
    node.typeArguments !== undefined &&
    node.typeArguments.length > 0
  ) {
    return unwrapReturnTypeAnnotation(node.typeArguments[0]);
  }
  return node;
};

/**
 * Leftmost identifier of a name as written: `A.B.C` → `A` for both qualified type names and
 * property-access expressions (the form heritage clauses use).
 */
export const leftmostIdentifier = (
  name: ts.EntityName | ts.Expression,
): ts.Identifier | undefined => {
  if (ts.isIdentifier(name)) {
    return name;
  }
  if (ts.isQualifiedName(name)) {
    return leftmostIdentifier(name.left);
  }
  if (ts.isPropertyAccessExpression(name)) {
    return leftmostIdentifier(name.expression);
  }
  return undefined;
};

/**
 * The name node of a contract site: the type name of a type reference, or the heritage clause's
 * expression. Undefined when the site is not a named reference at all.
 */
export const contractSiteNameNode = (
  node: ts.TypeNode,
): ts.EntityName | ts.Expression | undefined => {
  if (ts.isExpressionWithTypeArguments(node)) {
    return node.expression;
  }
  if (ts.isTypeReferenceNode(node)) {
    return node.typeName;
  }
  return undefined;
};

/**
 * Contract identity resolved from a unit's written contract site.
 *
 * Identity is syntactic: the site must be a single named type reference (possibly with type
 * arguments) after unwrapping `Promise<T>` and parentheses. Import aliases are followed (an
 * aliased import names the same declaration; the contract name is the declared name), but
 * type-level aliases are NOT — `type QueueTask = WorkerTaskBase` used as an annotation is the
 * distinct contract `QueueTask`.
 */
export type AnnotationContractResolution =
  | {
      kind: "resolved";
      /** Declared exported name at the declaration site (import aliases unwrapped). */
      contractName: string;
      /** Leftmost identifier as written in the unit's file (for the local-scope check). */
      writtenName: string;
      declSourceFile: ts.SourceFile;
    }
  | { kind: "missing_annotation" }
  | { kind: "inline_object" }
  | { kind: "anonymous_union" }
  /** Keyword/array/inline-intersection/other non-reference forms — skipped, not hard errors. */
  | { kind: "unsupported" }
  | { kind: "unresolved"; writtenName: string };

/**
 * Resolves a contract site's type reference to its declaration.
 *
 * The checker is used ONLY as a declaration locator (`getSymbolAtLocation` on the written name,
 * plus `getAliasedSymbol` to unwrap import aliases). No type normalization
 * (`getApparentType` / `getReturnTypeOfSignature`) participates in identity.
 */
export const resolveAnnotationContract = (
  checker: ts.TypeChecker,
  contractSite: ts.TypeNode | undefined,
): AnnotationContractResolution => {
  if (contractSite === undefined) {
    return { kind: "missing_annotation" };
  }

  const unwrapped = unwrapReturnTypeAnnotation(contractSite);

  if (ts.isTypeLiteralNode(unwrapped)) {
    return { kind: "inline_object" };
  }
  if (ts.isUnionTypeNode(unwrapped)) {
    return { kind: "anonymous_union" };
  }

  const nameNode = contractSiteNameNode(unwrapped);
  if (nameNode === undefined) {
    return { kind: "unsupported" };
  }

  const leftmost = leftmostIdentifier(nameNode);
  if (leftmost === undefined) {
    return { kind: "unsupported" };
  }
  const writtenName = leftmost.text;

  let symbol = checker.getSymbolAtLocation(nameNode);
  if (symbol === undefined) {
    return { kind: "unresolved", writtenName };
  }

  while ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    const aliased = checker.getAliasedSymbol(symbol);
    if (aliased === symbol) {
      break;
    }
    symbol = aliased;
  }

  const decl = symbol.declarations?.[0];
  if (decl === undefined) {
    return { kind: "unresolved", writtenName };
  }
  if (ts.isTypeParameterDeclaration(decl)) {
    return { kind: "unsupported" };
  }

  return {
    kind: "resolved",
    contractName: symbol.getName(),
    writtenName,
    declSourceFile: decl.getSourceFile(),
  };
};

/**
 * Module specifier the unit's file already uses to import the contract site's written name, read
 * from the import declaration AST. Consumed by `computeManifestModuleSpecifier`, which only honors
 * it when it is a bare package specifier.
 */
export const contractSiteImportModuleSpecifier = (
  checker: ts.TypeChecker,
  contractSite: ts.TypeNode,
  unitSourceFile: ts.SourceFile,
): string | undefined => {
  const nameNode = contractSiteNameNode(contractSite);
  if (nameNode === undefined) {
    return undefined;
  }
  const leftmost = leftmostIdentifier(nameNode);
  if (leftmost === undefined) {
    return undefined;
  }

  const local = checker.getSymbolAtLocation(leftmost);
  if (local === undefined) {
    return undefined;
  }
  for (const decl of local.declarations ?? []) {
    if (decl.getSourceFile() !== unitSourceFile) {
      continue;
    }
    let node: ts.Node | undefined = decl;
    while (node !== undefined) {
      if (ts.isImportDeclaration(node)) {
        return ts.isStringLiteralLike(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : undefined;
      }
      node = node.parent;
    }
  }
  return undefined;
};
