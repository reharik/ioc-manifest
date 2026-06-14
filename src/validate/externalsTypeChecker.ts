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

export const getSupplierPropertyTypes = (
  ctx: ValidateTypeCheckerContext,
  suppliers: readonly { readonly typesPath: string }[],
  interfaceName: string,
  propertyKey: string,
): ts.Type[] =>
  suppliers
    .map((slice) =>
      getInterfacePropertyType(ctx, slice.typesPath, interfaceName, propertyKey),
    )
    .filter((type): type is ts.Type => type !== undefined);

export const isSuppliedAssignableToDemandedTypes = (
  checker: ts.TypeChecker,
  demanded: ts.Type,
  supplierTypes: readonly ts.Type[],
): boolean =>
  supplierTypes.every((supplied) =>
    checker.isTypeAssignableTo(supplied, demanded),
  );

export const formatSupplierTypes = (
  checker: ts.TypeChecker,
  supplierTypes: readonly ts.Type[],
): string => {
  if (supplierTypes.length === 0) {
    return "unknown";
  }
  if (supplierTypes.length === 1) {
    return formatCheckerType(checker, supplierTypes[0]!);
  }
  return supplierTypes
    .map((type) => formatCheckerType(checker, type))
    .join(" & ");
};

export const findFirstMismatchedPropertyAcrossSuppliers = (
  checker: ts.TypeChecker,
  demanded: ts.Type,
  supplierTypes: readonly ts.Type[],
): string | undefined => {
  for (const supplied of supplierTypes) {
    if (!checker.isTypeAssignableTo(supplied, demanded)) {
      return findFirstMismatchedProperty(checker, supplied, demanded);
    }
  }
  return undefined;
};

export const findFirstMismatchedProperty = (
  checker: ts.TypeChecker,
  supplied: ts.Type,
  demanded: ts.Type,
): string | undefined => {
  for (const prop of demanded.getProperties()) {
    const propName = prop.getName();
    const demandedProp = getPropertyType(checker, demanded, propName);
    const suppliedProp = getPropertyType(checker, supplied, propName);
    if (
      demandedProp !== undefined &&
      (suppliedProp === undefined ||
        !checker.isTypeAssignableTo(suppliedProp, demandedProp))
    ) {
      return propName;
    }
  }
  return undefined;
};

const getPropertyType = (
  checker: ts.TypeChecker,
  type: ts.Type,
  propertyName: string,
): ts.Type | undefined => {
  const prop = checker.getPropertyOfType(type, propertyName);
  if (prop === undefined) {
    return undefined;
  }
  return checker.getTypeOfSymbol(prop);
};

export const formatCheckerType = (
  checker: ts.TypeChecker,
  type: ts.Type,
): string => checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
