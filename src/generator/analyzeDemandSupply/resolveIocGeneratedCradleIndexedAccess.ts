import path from "node:path";
import ts from "typescript";
import type { IocGroupsManifest } from "../../core/manifest.js";
import { IOC_REGISTRY_TYPES_BASENAME } from "../manifestPaths.js";
import { groupKeyToTypeAliasName } from "../naming.js";

const IOC_GENERATED_CRADLE_NAME = "IocGeneratedCradle";

/** Basename of the generated registry-types file with its extension dropped (`ioc-registry.types`),
 * so a `.js` import specifier and the `.ts` source file compare equal. */
const REGISTRY_TYPES_BASENAME_STEM = IOC_REGISTRY_TYPES_BASENAME.replace(
  /\.(?:m|c)?[jt]sx?$/,
  "",
);

const moduleSpecifierBasenameStem = (specifier: string): string =>
  path.basename(specifier).replace(/\.(?:m|c)?[jt]sx?$/, "");

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
    const symbol = checker.getSymbolAtLocation(typeNode.typeName);
    const aliasDecl = symbol?.declarations?.[0];
    if (aliasDecl !== undefined && ts.isTypeAliasDeclaration(aliasDecl)) {
      return resolveDepsPropertyTypeNode(aliasDecl.type, checker, depth + 1);
    }
  }

  return typeNode;
};

const isIocGeneratedCradleImportBinding = (
  checker: ts.TypeChecker,
  typeName: ts.EntityName,
): boolean => {
  if (!ts.isIdentifier(typeName)) {
    return false;
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
): boolean => {
  if (!ts.isTypeReferenceNode(node)) {
    return false;
  }
  return isIocGeneratedCradleImportBinding(checker, node.typeName);
};

/**
 * When a deps property is typed as `IocGeneratedCradle['literalKey']`, returns `literalKey`
 * without resolving through the (possibly circular/stale) generated cradle file.
 */
export const tryParseIocGeneratedCradleIndexedAccessKey = (
  checker: ts.TypeChecker,
  typeNode: ts.TypeNode | undefined,
): string | undefined => {
  const resolved = resolveDepsPropertyTypeNode(typeNode, checker);
  if (resolved === undefined || !ts.isIndexedAccessTypeNode(resolved)) {
    return undefined;
  }
  if (!isIocGeneratedCradleTypeNode(checker, resolved.objectType)) {
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
 * When a deps property is typed as a bare reference to a group's exported type alias imported by
 * name from the generated registry-types file
 * (`import type { Channels } from './generated/ioc-registry.types.js'` → `deps: { channels: Channels }`),
 * returns the group key (`channels`).
 *
 * ENTIRELY SYNTACTIC and cold-start-safe: it reads the import specifier node and reverse-maps the
 * imported name against the groups manifest. It never resolves the alias's underlying type or reads
 * the alias declaration from the generated file — either would reintroduce the chicken-egg where the
 * generated file must already exist for the deps-resolution pass to succeed. The import specifier is
 * present in the factory source even when the target module cannot resolve on a cold start, so the
 * module specifier is matched on BASENAME only (the full path can't be resolved yet).
 */
export const tryParseConsumedGroupAliasKey = (
  checker: ts.TypeChecker,
  typeNode: ts.TypeNode | undefined,
  groupsManifest: IocGroupsManifest | undefined,
): string | undefined => {
  if (groupsManifest === undefined) {
    return undefined;
  }

  const resolved = resolveDepsPropertyTypeNode(typeNode, checker);
  if (
    resolved === undefined ||
    !ts.isTypeReferenceNode(resolved) ||
    (resolved.typeArguments !== undefined && resolved.typeArguments.length > 0) ||
    !ts.isIdentifier(resolved.typeName)
  ) {
    return undefined;
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
    if (importedName === undefined) {
      continue;
    }
    for (const key of Object.keys(groupsManifest)) {
      if (groupKeyToTypeAliasName(key) === importedName) {
        return key;
      }
    }
  }

  return undefined;
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
