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

/** Written name of the scope-root marker type exported by this package. */
export const SCOPE_ROOT_MARKER_NAME = "ScopeRoot";

/** The form the marker must be written in, quoted verbatim by the wrong-arity error. */
export const SCOPE_ROOT_MARKER_FORM = `${SCOPE_ROOT_MARKER_NAME}<TContract, TLbv>`;

/**
 * A contract site read as a `ScopeRoot<...>` reference.
 *
 * `wrong_arity` is a hard error rather than a skip: writing `ScopeRoot` at all is an unambiguous
 * attempt to declare a scope root, and the missing type argument is exactly the declaration this
 * feature refuses to infer.
 */
export type ScopeRootMarker =
  | { kind: "none" }
  | {
      kind: "scope_root";
      /** First type argument: the root contract site, resolved by the ordinary identity path. */
      contractSite: ts.TypeNode;
      /** Second type argument, captured verbatim. Stage 1 never resolves or verifies it. */
      lbvTypeNode: ts.TypeNode;
    }
  | { kind: "wrong_arity"; typeArgumentCount: number };

/**
 * Reads a `ScopeRoot<...>` marker at an already parens/`Promise`-unwrapped type node.
 *
 * Recognition is by written name with no checker involvement — the same trade the `Promise<T>`
 * unwrap below already makes. A locally-declared `ScopeRoot` shadows the marker, which is
 * consistent with v3's rule that identity is what the author wrote.
 */
const readScopeRootMarker = (node: ts.TypeNode): ScopeRootMarker => {
  if (
    !ts.isTypeReferenceNode(node) ||
    !ts.isIdentifier(node.typeName) ||
    node.typeName.text !== SCOPE_ROOT_MARKER_NAME
  ) {
    return { kind: "none" };
  }

  const typeArguments = node.typeArguments ?? [];
  if (typeArguments.length !== 2) {
    return { kind: "wrong_arity", typeArgumentCount: typeArguments.length };
  }

  return {
    kind: "scope_root",
    contractSite: typeArguments[0]!,
    lbvTypeNode: typeArguments[1]!,
  };
};

/** Parentheses and `Promise<T>` only — the wrappers that are never themselves the contract. */
const unwrapAwaitedAnnotation = (node: ts.TypeNode): ts.TypeNode => {
  if (ts.isParenthesizedTypeNode(node)) {
    return unwrapAwaitedAnnotation(node.type);
  }
  if (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === "Promise" &&
    node.typeArguments !== undefined &&
    node.typeArguments.length > 0
  ) {
    return unwrapAwaitedAnnotation(node.typeArguments[0]);
  }
  return node;
};

/**
 * The `ScopeRoot<...>` marker at a contract site, with parentheses and `Promise<T>` stripped first
 * so `Promise<ScopeRoot<C, L>>` (an async scope-root factory) reads the same as the sync form.
 */
export const scopeRootMarkerAtContractSite = (
  node: ts.TypeNode,
): ScopeRootMarker => readScopeRootMarker(unwrapAwaitedAnnotation(node));

/**
 * Syntactically unwraps a factory return annotation to the contract reference: strips
 * parentheses, `Promise<T>` wrappers, and the `ScopeRoot<TContract, TLbv>` marker (all by written
 * name, no checker). The result is what the author wrote — type-level aliases are never followed.
 * A class `implements` entry passes through unchanged (none of these wrappers is legal there).
 *
 * `ScopeRoot` unwraps to its FIRST type argument for exactly the reason `Promise` unwraps to its
 * type argument: neither is the contract, both wrap it. Every existing consumer of this function —
 * contract identity, the type-only import specifier, the lifetime-marker walk — therefore enters at
 * the root contract with no further change. A wrong-arity `ScopeRoot` is left intact here and
 * reported by {@link resolveAnnotationContract}, which is the one place that can raise it.
 */
export const unwrapReturnTypeAnnotation = (node: ts.TypeNode): ts.TypeNode => {
  const awaited = unwrapAwaitedAnnotation(node);
  const marker = readScopeRootMarker(awaited);
  return marker.kind === "scope_root"
    ? unwrapReturnTypeAnnotation(marker.contractSite)
    : awaited;
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
      /**
       * Set when the site was written as `ScopeRoot<TContract, TLbv>`. Side-band only: the resolved
       * contract above is `TContract`, unchanged by the marker. Stage 1 captures the declared lbv
       * type node and resolves nothing about it.
       */
      scopeRoot?: DeclaredScopeRootSite;
    }
  | { kind: "missing_annotation" }
  | { kind: "inline_object" }
  | { kind: "anonymous_union" }
  /** Keyword/array/inline-intersection/other non-reference forms — skipped, not hard errors. */
  | { kind: "unsupported" }
  | { kind: "unresolved"; writtenName: string }
  /** `ScopeRoot` written with other than two type arguments — a hard error, never a silent skip. */
  | { kind: "scope_root_wrong_arity"; typeArgumentCount: number };

/** The declared scope-root facts read off a contract site, before any verification. */
export type DeclaredScopeRootSite = {
  /**
   * The declared late-bound-value type argument, captured verbatim as written. Stage 1 never
   * resolves, normalizes, or verifies it; stage 2 checks it against the subtree's scope-demands.
   */
  lbvTypeNode: ts.TypeNode;
  /** `lbvTypeNode` source text, so reporting layers need no AST. */
  lbvTypeText: string;
};

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

  // Marker-unwrap first, so identity resolves against the ROOT contract while the declared lbv is
  // captured side-band. Arity is the only thing checked about the marker here; the lbv type
  // argument is carried verbatim and left entirely alone (stage 2 owns it).
  const marker = scopeRootMarkerAtContractSite(contractSite);
  if (marker.kind === "wrong_arity") {
    return {
      kind: "scope_root_wrong_arity",
      typeArgumentCount: marker.typeArgumentCount,
    };
  }
  const scopeRoot: DeclaredScopeRootSite | undefined =
    marker.kind === "scope_root"
      ? {
          lbvTypeNode: marker.lbvTypeNode,
          lbvTypeText: marker.lbvTypeNode.getText(),
        }
      : undefined;

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
    ...(scopeRoot !== undefined ? { scopeRoot } : {}),
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
