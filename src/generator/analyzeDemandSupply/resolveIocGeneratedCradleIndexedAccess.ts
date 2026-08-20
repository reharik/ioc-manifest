import path from "node:path";
import ts from "typescript";
import type { IocGroupsManifest } from "../../core/manifest.js";
import {
  collectGeneratedRegistryBindings,
  resolveGeneratedBindingReference,
  IOC_GENERATED_CRADLE_NAME,
} from "../generatedRegistryBindings.js";
import {
  moduleSpecifierBasenameStem,
  REGISTRY_TYPES_BASENAME_STEM,
} from "../generatedRegistrySpecifier.js";
import { groupKeyToTypeAliasName } from "../naming.js";

/** True when a source file IS the generated registry-types file (matched on basename stem). */
export const isGeneratedRegistrySourceFile = (
  sourceFile: ts.SourceFile,
): boolean =>
  moduleSpecifierBasenameStem(sourceFile.fileName) ===
  REGISTRY_TYPES_BASENAME_STEM;

/**
 * The generated-registry bindings of the file a type node lives in. Recomputed per call rather
 * than cached: it walks top-level statements only, and a cache keyed by source file would have to
 * be invalidated per `generatedDir` (tests and composed runs vary it within one process).
 */
const bindingsForNode = (
  node: ts.Node,
  generatedDir: string,
): ReturnType<typeof collectGeneratedRegistryBindings> => {
  const sourceFile = node.getSourceFile();
  return collectGeneratedRegistryBindings(
    sourceFile,
    path.resolve(sourceFile.fileName),
    generatedDir,
  );
};

/**
 * The generated export named by a namespace-qualified type reference (`Ioc.Channels` → `Channels`),
 * or `undefined` when the entity name is not qualified through a namespace import of the generated
 * file. ENTIRELY SYNTACTIC: the namespace binding is read off the file's import statements, so it
 * resolves on a cold start where the generated module cannot be loaded.
 */
const namespaceQualifiedGeneratedName = (
  typeName: ts.EntityName,
  generatedDir: string,
): string | undefined => {
  if (!ts.isQualifiedName(typeName)) {
    return undefined;
  }
  const reference = resolveGeneratedBindingReference(
    typeName,
    bindingsForNode(typeName, generatedDir),
  );
  if (
    reference === undefined ||
    reference.overQualified ||
    reference.binding.kind !== "namespace"
  ) {
    return undefined;
  }
  return reference.referencedName;
};

const propertyNameText = (name: ts.PropertyName): string | undefined => {
  if (ts.isIdentifier(name)) {
    return name.text;
  }
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
};

const getDepsTypeDeclaration = (
  checker: ts.TypeChecker,
  depsType: ts.Type,
): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined => {
  const apparent = checker.getApparentType(depsType);
  let symbol = apparent.aliasSymbol ?? apparent.getSymbol();
  if (!symbol) {
    return undefined;
  }
  if (symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  const decl = symbol.declarations?.[0];
  if (
    decl !== undefined &&
    (ts.isInterfaceDeclaration(decl) || ts.isTypeAliasDeclaration(decl))
  ) {
    return decl;
  }
  return undefined;
};

const collectPropertyTypeNodes = (
  decl: ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
): Map<string, ts.TypeNode> => {
  const out = new Map<string, ts.TypeNode>();

  const members = ts.isInterfaceDeclaration(decl)
    ? decl.members
    : ts.isTypeLiteralNode(decl.type)
      ? decl.type.members
      : undefined;

  if (members === undefined) {
    return out;
  }

  for (const member of members) {
    if (!ts.isPropertySignature(member) || member.type === undefined) {
      continue;
    }
    const name = member.name !== undefined ? propertyNameText(member.name) : undefined;
    if (name === undefined) {
      continue;
    }
    out.set(name, member.type);
  }

  return out;
};

/**
 * The type-alias declaration a bare type reference names, following ONE import hop so an alias
 * declared in another source file is reachable (`aliases.ts: export type Local = Channels`).
 *
 * Never follows into the generated registry file itself: an import of `Channels` or
 * `IocGeneratedCradle` from the generated output is the thing the callers claim syntactically, and
 * reading its declaration would be exactly the type resolution through prior output this module
 * exists to avoid. On a cold start the import does not resolve at all and this returns `undefined`,
 * which is the same answer.
 */
const typeAliasDeclarationFor = (
  checker: ts.TypeChecker,
  typeName: ts.EntityName,
): ts.TypeAliasDeclaration | undefined => {
  let symbol = checker.getSymbolAtLocation(typeName);
  if (symbol === undefined) {
    return undefined;
  }
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    const aliased = checker.getAliasedSymbol(symbol);
    if (aliased === undefined) {
      return undefined;
    }
    symbol = aliased;
  }
  const decl = symbol.declarations?.[0];
  if (decl === undefined || !ts.isTypeAliasDeclaration(decl)) {
    return undefined;
  }
  return isGeneratedRegistrySourceFile(decl.getSourceFile()) ? undefined : decl;
};

/**
 * Follows a chain of bare type-alias references to the type node that actually carries the shape,
 * so `type Local = IocGeneratedCradle['x']` and a `Local` re-exported from another module both
 * present the same node to the claim parsers below. Aliases carrying type arguments are not
 * followed: instantiating a generic is type resolution, and the resulting form is rejected.
 */
export const resolveDepsPropertyTypeNode = (
  typeNode: ts.TypeNode | undefined,
  checker: ts.TypeChecker,
  depth = 0,
): ts.TypeNode | undefined => {
  if (typeNode === undefined || depth > 8) {
    return typeNode;
  }

  if (
    ts.isTypeReferenceNode(typeNode) &&
    (typeNode.typeArguments === undefined || typeNode.typeArguments.length === 0)
  ) {
    const aliasDecl = typeAliasDeclarationFor(checker, typeNode.typeName);
    if (aliasDecl !== undefined) {
      return resolveDepsPropertyTypeNode(aliasDecl.type, checker, depth + 1);
    }
  }

  return typeNode;
};

const isIocGeneratedCradleImportBinding = (
  checker: ts.TypeChecker,
  typeName: ts.EntityName,
  generatedDir: string,
): boolean => {
  if (!ts.isIdentifier(typeName)) {
    return (
      namespaceQualifiedGeneratedName(typeName, generatedDir) ===
      IOC_GENERATED_CRADLE_NAME
    );
  }
  if (typeName.text === IOC_GENERATED_CRADLE_NAME) {
    return true;
  }
  const symbol = checker.getSymbolAtLocation(typeName);
  if (symbol === undefined) {
    return false;
  }
  for (const decl of symbol.declarations ?? []) {
    if (!ts.isImportSpecifier(decl)) {
      continue;
    }
    const importedName =
      decl.propertyName !== undefined && ts.isIdentifier(decl.propertyName)
        ? decl.propertyName.text
        : ts.isIdentifier(decl.name)
          ? decl.name.text
          : undefined;
    if (importedName === IOC_GENERATED_CRADLE_NAME) {
      return true;
    }
  }
  return false;
};

const isIocGeneratedCradleTypeNode = (
  checker: ts.TypeChecker,
  node: ts.TypeNode,
  generatedDir: string,
): boolean => {
  // A type-argument-bearing reference (`Cradle<T>['k']`) is a rejected form, never a claimed one.
  if (
    !ts.isTypeReferenceNode(node) ||
    (node.typeArguments !== undefined && node.typeArguments.length > 0)
  ) {
    return false;
  }
  return isIocGeneratedCradleImportBinding(checker, node.typeName, generatedDir);
};

/**
 * When a deps property is typed as `IocGeneratedCradle['literalKey']`, returns `literalKey`
 * without resolving through the (possibly circular/stale) generated cradle file.
 */
export const tryParseIocGeneratedCradleIndexedAccessKey = (
  checker: ts.TypeChecker,
  typeNode: ts.TypeNode | undefined,
  generatedDir: string,
): string | undefined => {
  const resolved = resolveDepsPropertyTypeNode(typeNode, checker);
  if (resolved === undefined || !ts.isIndexedAccessTypeNode(resolved)) {
    return undefined;
  }
  if (!isIocGeneratedCradleTypeNode(checker, resolved.objectType, generatedDir)) {
    return undefined;
  }
  const indexType = resolved.indexType;
  if (
    ts.isLiteralTypeNode(indexType) &&
    ts.isStringLiteral(indexType.literal)
  ) {
    return indexType.literal.text;
  }
  return undefined;
};

/**
 * The name imported by an `ImportSpecifier` (`import type { A as B }` → `A`; `import type { A }` → `A`).
 */
const importSpecifierImportedName = (
  spec: ts.ImportSpecifier,
): string | undefined => {
  if (spec.propertyName !== undefined && ts.isIdentifier(spec.propertyName)) {
    return spec.propertyName.text;
  }
  if (ts.isIdentifier(spec.name)) {
    return spec.name.text;
  }
  return undefined;
};

/** The `ImportDeclaration` a named binding was imported through, if the symbol is one. */
const importDeclarationForSpecifier = (
  spec: ts.ImportSpecifier,
): ts.ImportDeclaration | undefined =>
  ts.findAncestor(spec, ts.isImportDeclaration) ?? undefined;

/**
 * The name a deps-position type node reaches INTO the generated registry-types file by, when it is
 * a bare reference to a name exported from that file — `undefined` otherwise.
 *
 * This is the single recognition mechanism behind every by-name claim form (group aliases, and the
 * scope-root opener aliases below). ENTIRELY SYNTACTIC and cold-start-safe: it reads the import
 * specifier node and hands back the name that was imported. It never resolves the alias's
 * underlying type or reads the alias declaration from the generated file — either would reintroduce
 * the chicken-egg where the generated file must already exist for the deps-resolution pass to
 * succeed. The import specifier is present in the factory source even when the target module cannot
 * resolve on a cold start, so the module specifier is matched on BASENAME only (the full path can't
 * be resolved yet). A namespace import (`import type * as Ioc from '…'` → `Ioc.Channels`) is read
 * the same way, straight off the file's import statements.
 *
 * What the name MEANS is the caller's business: each claim parser reverse-maps it against its own
 * enumeration of emitted names, so an unrecognized name stays unclaimed and reaches the backstop.
 */
const generatedRegistryAliasNameOf = (
  checker: ts.TypeChecker,
  typeNode: ts.TypeNode | undefined,
  generatedDir: string,
): string | undefined => {
  const resolved = resolveDepsPropertyTypeNode(typeNode, checker);
  if (
    resolved === undefined ||
    !ts.isTypeReferenceNode(resolved) ||
    (resolved.typeArguments !== undefined && resolved.typeArguments.length > 0)
  ) {
    return undefined;
  }

  if (!ts.isIdentifier(resolved.typeName)) {
    return namespaceQualifiedGeneratedName(resolved.typeName, generatedDir);
  }

  const symbol = checker.getSymbolAtLocation(resolved.typeName);
  if (symbol === undefined) {
    return undefined;
  }

  for (const decl of symbol.declarations ?? []) {
    if (!ts.isImportSpecifier(decl)) {
      continue;
    }
    const importDecl = importDeclarationForSpecifier(decl);
    if (
      importDecl === undefined ||
      !ts.isStringLiteral(importDecl.moduleSpecifier)
    ) {
      continue;
    }
    if (
      moduleSpecifierBasenameStem(importDecl.moduleSpecifier.text) !==
      REGISTRY_TYPES_BASENAME_STEM
    ) {
      continue;
    }
    const importedName = importSpecifierImportedName(decl);
    if (importedName !== undefined) {
      return importedName;
    }
  }

  return undefined;
};

/**
 * When a deps property is typed as a bare reference to a group's exported type alias imported by
 * name from the generated registry-types file
 * (`import type { Channels } from './generated/ioc-registry.types.js'` → `deps: { channels: Channels }`),
 * returns the group key (`channels`).
 *
 * Recognition is by name against the groups manifest — see {@link generatedRegistryAliasNameOf} for
 * why the name, and not the type behind it, is what gets read.
 */
export const tryParseConsumedGroupAliasKey = (
  checker: ts.TypeChecker,
  typeNode: ts.TypeNode | undefined,
  groupsManifest: IocGroupsManifest | undefined,
  generatedDir: string,
): string | undefined => {
  if (groupsManifest === undefined) {
    return undefined;
  }

  const aliasName = generatedRegistryAliasNameOf(
    checker,
    typeNode,
    generatedDir,
  );
  if (aliasName === undefined) {
    return undefined;
  }

  for (const key of Object.keys(groupsManifest)) {
    if (groupKeyToTypeAliasName(key) === aliasName) {
      return key;
    }
  }
  return undefined;
};

/**
 * When a deps property is typed as a bare reference to an emitted scope-root OPENER's exported type
 * alias
 * (`import type { OpenAuthRouterScope } from './generated/ioc-registry.types.js'`
 * → `deps: { openAuthRouterScope: OpenAuthRouterScope }`), returns the opener's cradle key
 * (`openAuthRouterScope`).
 *
 * The opener is the sanctioned scope-resolver handle, injectable like any other registration
 * (`docs/design/scope-roots.md`, "What stage 3 emits"), so it is an enumerated generated-reference
 * form in a deps position — `openerAliasReference` — rather than a relaxation of the general
 * prohibition. Recognition is the SAME mechanism the group-alias form uses: the alias name read off
 * the import specifier, reverse-mapped against the names this generation emits
 * ({@link openerKeysByTypeAliasName}). Nothing about the opener's function type is resolved here;
 * the reference is carried by name and printed back by name.
 */
export const tryParseConsumedScopeRootOpenerAliasKey = (
  checker: ts.TypeChecker,
  typeNode: ts.TypeNode | undefined,
  openerKeysByAliasName: ReadonlyMap<string, string> | undefined,
  generatedDir: string,
): string | undefined => {
  if (openerKeysByAliasName === undefined || openerKeysByAliasName.size === 0) {
    return undefined;
  }
  const aliasName = generatedRegistryAliasNameOf(
    checker,
    typeNode,
    generatedDir,
  );
  return aliasName === undefined
    ? undefined
    : openerKeysByAliasName.get(aliasName);
};

export const depsPropertyTypeNodeByName = (
  checker: ts.TypeChecker,
  depsType: ts.Type,
): Map<string, ts.TypeNode> => {
  const decl = getDepsTypeDeclaration(checker, depsType);
  if (decl === undefined) {
    return new Map();
  }
  return collectPropertyTypeNodes(decl);
};
