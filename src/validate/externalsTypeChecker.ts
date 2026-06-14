/**
 * @fileoverview Optional TypeScript checker for validate-time externals assignability.
 */
import ts from "typescript";
import { loadIocTsconfigContext } from "../generator/iocProgramContext.js";

const findInterfaceDeclaration = (
  sourceFile: ts.SourceFile,
  interfaceName: string,
): ts.InterfaceDeclaration | undefined => {
  let found: ts.InterfaceDeclaration | undefined;

  const visit = (node: ts.Node): void => {
    if (found !== undefined) {
      return;
    }
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
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

export type ValidateTypeCheckerContext = {
  readonly checker: ts.TypeChecker;
  readonly program: ts.Program;
  readonly customConditions: readonly string[] | undefined;
};

export const createValidateTypeChecker = (
  projectRoot: string,
  typesPaths: readonly string[],
): ValidateTypeCheckerContext | undefined => {
  if (typesPaths.length === 0) {
    return undefined;
  }

  try {
    const { options, customConditions } = loadIocTsconfigContext(projectRoot);
    const program = ts.createProgram({
      rootNames: [...typesPaths],
      options: { ...options, noEmit: true },
    });
    return {
      checker: program.getTypeChecker(),
      program,
      customConditions,
    };
  } catch {
    return undefined;
  }
};

export const getInterfacePropertyType = (
  ctx: ValidateTypeCheckerContext,
  typesPath: string,
  interfaceName: string,
  propertyKey: string,
): ts.Type | undefined => {
  const sourceFile = ctx.program.getSourceFile(typesPath);
  if (sourceFile === undefined) {
    return undefined;
  }

  const iface = findInterfaceDeclaration(sourceFile, interfaceName);
  if (iface === undefined) {
    return undefined;
  }

  for (const member of iface.members) {
    if (!ts.isPropertySignature(member) || member.name === undefined) {
      continue;
    }
    const key = readPropertyName(member.name);
    if (key !== propertyKey || member.type === undefined) {
      continue;
    }
    return ctx.checker.getTypeFromTypeNode(member.type);
  }

  return undefined;
};

export const intersectTypes = (
  checker: ts.TypeChecker,
  types: readonly ts.Type[],
): ts.Type | undefined => {
  if (types.length === 0) {
    return undefined;
  }
  if (types.length === 1) {
    return types[0];
  }
  return checker.getIntersectionType([...types]);
};

export const findFirstMismatchedProperty = (
  checker: ts.TypeChecker,
  supplied: ts.Type,
  demanded: ts.Type,
): string | undefined => {
  for (const prop of demanded.getProperties()) {
    const propName = prop.getName();
    const demandedProp = checker.getTypeOfPropertyOfType(demanded, propName);
    const suppliedProp = checker.getTypeOfPropertyOfType(supplied, propName);
    if (
      demandedProp !== undefined &&
      (suppliedProp === undefined ||
        !checker.isTypeAssignableTo(demandedProp, suppliedProp))
    ) {
      return propName;
    }
  }
  return undefined;
};

export const formatCheckerType = (
  checker: ts.TypeChecker,
  type: ts.Type,
): string => checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
