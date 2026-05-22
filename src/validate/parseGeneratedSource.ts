/**
 * @fileoverview Shared TypeScript AST helpers for parsing generated IoC artifacts.
 */
import ts from "typescript";
import { IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS } from "../core/manifest.js";
import type {
  ParsedGroupRoot,
  ParsedImplementationMeta,
} from "./types.js";

const unwrapObjectLiteral = (
  expr: ts.Expression,
): ts.ObjectLiteralExpression | undefined => {
  if (ts.isObjectLiteralExpression(expr)) {
    return expr;
  }
  if (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
    return unwrapObjectLiteral(expr.expression);
  }
  return undefined;
};

const readStringLiteral = (node: ts.Expression): string | undefined => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
};

const readBooleanLiteral = (node: ts.Expression): boolean | undefined => {
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  return undefined;
};

const readPropertyName = (name: ts.PropertyName): string | undefined => {
  if (ts.isIdentifier(name)) {
    return name.text;
  }
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  return undefined;
};

const typeNodeToText = (node: ts.TypeNode, sourceFile: ts.SourceFile): string =>
  node.getText(sourceFile).trim();

const findIocManifestObject = (
  sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression | undefined => {
  let found: ts.ObjectLiteralExpression | undefined;

  const visit = (node: ts.Node): void => {
    if (found !== undefined) {
      return;
    }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        const manifestObject =
          decl.initializer !== undefined
            ? unwrapObjectLiteral(decl.initializer)
            : undefined;
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === "iocManifest" &&
          manifestObject !== undefined
        ) {
          found = manifestObject;
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
};

const parseImplementationMeta = (
  obj: ts.ObjectLiteralExpression,
): ParsedImplementationMeta | undefined => {
  let registrationKey: string | undefined;
  let defaultFlag: boolean | undefined;

  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      continue;
    }
    const key = readPropertyName(prop.name);
    if (key === "registrationKey") {
      registrationKey = readStringLiteral(prop.initializer);
    }
    if (key === "default") {
      defaultFlag = readBooleanLiteral(prop.initializer);
    }
  }

  if (registrationKey === undefined) {
    return undefined;
  }

  return {
    registrationKey,
    ...(defaultFlag === true ? { default: true as const } : {}),
  };
};

const parseGroupMembersRaw = (initializer: ts.Expression): unknown => {
  if (ts.isArrayLiteralExpression(initializer)) {
    return initializer.elements.map((el) => el.getText());
  }
  const obj = unwrapObjectLiteral(initializer);
  if (obj === undefined) {
    return undefined;
  }
  const record: Record<string, { registrationKey?: string }> = {};
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      continue;
    }
    const key = readPropertyName(prop.name);
    if (key === undefined) {
      continue;
    }
    const leaf = unwrapObjectLiteral(prop.initializer);
    if (leaf === undefined) {
      continue;
    }
    let registrationKey: string | undefined;
    for (const leafProp of leaf.properties) {
      if (!ts.isPropertyAssignment(leafProp)) {
        continue;
      }
      if (readPropertyName(leafProp.name) === "registrationKey") {
        registrationKey = readStringLiteral(leafProp.initializer);
      }
    }
    record[key] = { registrationKey };
  }
  return record;
};

const parseGroupRoot = (
  obj: ts.ObjectLiteralExpression,
): ParsedGroupRoot | undefined => {
  let kind: "collection" | "object" | undefined;
  let baseType: string | undefined;
  let baseTypeId: string | undefined;
  let members: unknown;

  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      continue;
    }
    const key = readPropertyName(prop.name);
    if (key === "kind") {
      const k = readStringLiteral(prop.initializer);
      if (k === "collection" || k === "object") {
        kind = k;
      }
    }
    if (key === "baseType") {
      baseType = readStringLiteral(prop.initializer);
    }
    if (key === "baseTypeId") {
      baseTypeId = readStringLiteral(prop.initializer);
    }
    if (key === "members") {
      members = parseGroupMembersRaw(prop.initializer);
    }
  }

  if (
    kind === undefined ||
    baseType === undefined ||
    baseTypeId === undefined ||
    members === undefined
  ) {
    return undefined;
  }

  return { kind, baseType, baseTypeId, members };
};

export type ParsedManifestFromSource = {
  readonly manifestSchemaVersion: unknown;
  readonly contracts: Record<
    string,
    Record<string, ParsedImplementationMeta>
  >;
  readonly groupRoots: Record<string, ParsedGroupRoot>;
};

export const parseIocManifestSource = (
  content: string,
  manifestPath: string,
): ParsedManifestFromSource => {
  const sourceFile = ts.createSourceFile(
    manifestPath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const manifestObject = findIocManifestObject(sourceFile);
  if (manifestObject === undefined) {
    throw new Error(
      `[ioc] generated manifest at ${JSON.stringify(manifestPath)} does not export iocManifest`,
    );
  }

  let manifestSchemaVersion: unknown;
  const contracts: Record<string, Record<string, ParsedImplementationMeta>> =
    {};
  const groupRoots: Record<string, ParsedGroupRoot> = {};

  for (const prop of manifestObject.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      continue;
    }
    const key = readPropertyName(prop.name);
    if (key === undefined) {
      continue;
    }

    if (key === "manifestSchemaVersion") {
      if (ts.isNumericLiteral(prop.initializer)) {
        manifestSchemaVersion = Number(prop.initializer.text);
      } else {
        manifestSchemaVersion = prop.initializer.getText(sourceFile);
      }
      continue;
    }

    if (key === "contracts" && ts.isObjectLiteralExpression(prop.initializer)) {
      for (const contractProp of prop.initializer.properties) {
        if (
          !ts.isPropertyAssignment(contractProp) ||
          !ts.isIdentifier(contractProp.name) ||
          !ts.isObjectLiteralExpression(contractProp.initializer)
        ) {
          continue;
        }
        const contractName = contractProp.name.text;
        const impls: Record<string, ParsedImplementationMeta> = {};
        for (const implProp of contractProp.initializer.properties) {
          if (
            !ts.isPropertyAssignment(implProp) ||
            !ts.isIdentifier(implProp.name) ||
            !ts.isObjectLiteralExpression(implProp.initializer)
          ) {
            continue;
          }
          const meta = parseImplementationMeta(implProp.initializer);
          if (meta !== undefined) {
            impls[implProp.name.text] = meta;
          }
        }
        contracts[contractName] = impls;
      }
      continue;
    }

    if (IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS.has(key)) {
      continue;
    }

    const groupObj = unwrapObjectLiteral(prop.initializer);
    if (groupObj !== undefined) {
      const root = parseGroupRoot(groupObj);
      if (root !== undefined) {
        groupRoots[key] = root;
      }
    }
  }

  return {
    manifestSchemaVersion,
    contracts,
    groupRoots,
  };
};

const findInterfaceBody = (
  sourceFile: ts.SourceFile,
  interfaceName: string,
): ts.InterfaceDeclaration | undefined => {
  let found: ts.InterfaceDeclaration | undefined;

  const visit = (node: ts.Node): void => {
    if (found !== undefined) {
      return;
    }
    if (
      ts.isInterfaceDeclaration(node) &&
      node.name.text === interfaceName
    ) {
      found = node;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
};

export const parseInterfacePropertyNames = (
  content: string,
  filePath: string,
  interfaceName: string,
): ReadonlyMap<string, string> => {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const iface = findInterfaceBody(sourceFile, interfaceName);
  const result = new Map<string, string>();
  if (iface === undefined) {
    return result;
  }

  for (const member of iface.members) {
    if (!ts.isPropertySignature(member) || member.name === undefined) {
      continue;
    }
    const key = readPropertyName(member.name);
    if (key === undefined) {
      continue;
    }
    const typeText =
      member.type !== undefined
        ? typeNodeToText(member.type, sourceFile)
        : "unknown";
    result.set(key, typeText);
  }

  return result;
};
