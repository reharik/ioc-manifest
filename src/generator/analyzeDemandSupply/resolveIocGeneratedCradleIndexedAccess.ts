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
 * The generated export an entity name in a type position names, read off THIS file's import table
 * alone — no checker, no module resolution, and no look at what the target actually exports.
 *
 * Covers the named form (`import type { OpenAuthRouterScope } …` → `OpenAuthRouterScope`, under an
 * `as` alias too) and the namespace-qualified form (`Ioc.Channels` → `Channels`). A bare namespace
 * or default binding names no single export and answers `undefined`.
 *
 * Reading the import STATEMENT rather than the imported SYMBOL is what makes a name the current
 * generation is about to emit resolvable at all: on the run that first discovers a scope root the
 * generated file demonstrably does not export its opener alias yet, and on a cold start the file
 * does not exist — so asking the target would answer "no such name" for precisely the names that
 * are about to become real. What the name MEANS is still the caller's business; each claim parser
 * reverse-maps it against its own enumeration of the names THIS run emits.
 */
const generatedBindingReferencedName = (
  typeName: ts.EntityName,
  generatedDir: string,
): string | undefined => {
  const reference = resolveGeneratedBindingReference(
    typeName,
    bindingsForNode(typeName, generatedDir),
  );
  if (reference === undefined || reference.overQualified) {
    return undefined;
  }
  const expectedKind = ts.isIdentifier(typeName) ? "named" : "namespace";
  return reference.binding.kind === expectedKind
    ? reference.referencedName
    : undefined;
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

/**
 * True when an entity name in a type position denotes the generated cradle interface: the name
 * itself, or any local binding imported from the generated file under it — including a rename
 * (`import type { IocGeneratedCradle as Cradle }`) and the namespace-qualified spelling. Read off
 * the import table, so it holds against a generated file that is missing, stale, or (as when the
 * cradle predates a key being indexed off it) simply older than the run reading it.
 */
const isIocGeneratedCradleImportBinding = (
  checker: ts.TypeChecker,
  typeName: ts.EntityName,
  generatedDir: string,
): boolean => {
  if (ts.isIdentifier(typeName) && typeName.text === IOC_GENERATED_CRADLE_NAME) {
    return true;
  }
  if (
    generatedBindingReferencedName(typeName, generatedDir) ===
    IOC_GENERATED_CRADLE_NAME
  ) {
    return true;
  }
  if (!ts.isIdentifier(typeName)) {
    return false;
  }
  // Last resort: a local name the checker says was imported under the cradle's name, from a module
  // this run does not recognize as the generated file (a stand-in cradle in a test, a generated file
  // reached through a specifier neither the basename nor the path rule matches). Name-only, so it
  // stays a recognition of the cradle rather than of a module.
  const symbol = checker.getSymbolAtLocation(typeName);
  return (symbol?.declarations ?? []).some(
    (decl) =>
      ts.isImportSpecifier(decl) &&
      (decl.propertyName ?? decl.name).text === IOC_GENERATED_CRADLE_NAME,
  );
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
 * The name a deps-position type node reaches INTO the generated registry-types file by, when it is
 * a bare reference to a name that file is expected to export — `undefined` otherwise.
 *
 * This is the single recognition mechanism behind every by-name claim form (group aliases, and the
 * scope-root opener aliases below). ENTIRELY SYNTACTIC and cold-start-safe: the local name is
 * matched against the file's own import statements by {@link generatedBindingReferencedName}, which
 * hands back the name that was imported. Nothing asks whether the target actually exports it, and
 * the alias's underlying type is never resolved — either would reintroduce the chicken-and-egg
 * where the generated file must already contain a name before generation may write it.
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
  return generatedBindingReferencedName(resolved.typeName, generatedDir);
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

/**
 * The type node a property SYMBOL was WRITTEN with, wherever its declaration lives.
 *
 * The route to a deps property whose declaration is not a member of the deps type's own member list:
 * an intersection member (`type Deps = BaseDeps & { openAuthRouterScope: OpenAuthRouterScope }`) or
 * a mapped type's source (`Readonly<{ … }>`). The declaration is the source text the developer
 * wrote, so what comes back is still a syntactic reference — nothing here resolves a type.
 */
const symbolDeclaredTypeNode = (symbol: ts.Symbol): ts.TypeNode | undefined => {
  for (const decl of symbol.declarations ?? []) {
    if (
      (ts.isPropertySignature(decl) || ts.isPropertyDeclaration(decl)) &&
      decl.type !== undefined
    ) {
      return decl.type;
    }
  }
  return undefined;
};

/**
 * Every deps property's written type node, keyed by property name — the input every claim parser
 * reads instead of the checker's resolved type.
 *
 * Two sources, in order. The deps type's own declaration covers the ordinary shapes (an interface,
 * or a type alias of an object literal) and is preferred because it is reached without asking the
 * checker for members at all. Anything the developer composed — an intersection, a mapped type over
 * an object literal — has no single member list to read, so the remaining properties are picked up
 * from their own declarations via the property symbols.
 *
 * A property MISSING from this map is not a neutral outcome: with no node to read, every claim
 * parser declines and the property is handed to the checker, which resolves a generated name out of
 * prior output (stale types on a warm run) or fails to resolve one this generation has not written
 * yet (the same-generation scope-root opener). The second source exists so that a deps type's outer
 * shape cannot decide whether a reference is claimed.
 */
export const depsPropertyTypeNodeByName = (
  checker: ts.TypeChecker,
  depsType: ts.Type,
): Map<string, ts.TypeNode> => {
  const decl = getDepsTypeDeclaration(checker, depsType);
  const out =
    decl !== undefined
      ? collectPropertyTypeNodes(decl)
      : new Map<string, ts.TypeNode>();

  for (const prop of checker.getPropertiesOfType(
    checker.getApparentType(depsType),
  )) {
    const name = prop.getName();
    if (out.has(name)) {
      continue;
    }
    const typeNode = symbolDeclaredTypeNode(prop);
    if (typeNode !== undefined) {
      out.set(name, typeNode);
    }
  }

  return out;
};
