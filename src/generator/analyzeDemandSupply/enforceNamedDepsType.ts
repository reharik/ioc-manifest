import path from "node:path";
import ts from "typescript";
import type { FactorySourceLocation } from "./types.js";

const IOC_GENERATED_CRADLE_NAME = "IocGeneratedCradle";
const DOC_REF = "docs/design/per-package-manifest.md §3";

const formatFactoryLocation = (
  projectRoot: string,
  modulePath: string,
  line: number,
): string => {
  const abs = path.isAbsolute(modulePath)
    ? modulePath
    : path.join(projectRoot, modulePath);
  return `${path.relative(projectRoot, abs).replace(/\\/g, "/")}:${line}`;
};

/** "Factory" / "Class", for diagnostics that name the offending unit. */
const unitLabel = (loc: FactorySourceLocation): string =>
  loc.unitKind === "class" ? "Class" : "Factory";

const depsTypeHintBlock = (loc: FactorySourceLocation): string => {
  const { exportName } = loc;
  const base = exportName.startsWith("build")
    ? exportName.slice("build".length)
    : exportName;

  if (loc.unitKind === "class") {
    const depsName = base.length > 0 ? `${base}Deps` : "ClassDeps";
    return `  type ${depsName} = { foo: Foo; bar: Bar };
  export class ${exportName} implements <Contract> {
    constructor({ foo, bar }: ${depsName}) { ... }
  }`;
  }

  const depsName = base.length > 0 ? `${base}Deps` : "FactoryDeps";
  return `  type ${depsName} = { foo: Foo; bar: Bar };
  export const ${exportName} = ({ foo, bar }: ${depsName}): <ReturnType> => ({ ... });`;
};

const namedDepsBody = (
  loc: FactorySourceLocation,
  reasonLine: string,
): string =>
  `[ioc] ${unitLabel(loc)} ${JSON.stringify(loc.exportName)} at ${reasonLine}
Use a named local deps type instead:

${depsTypeHintBlock(loc)}

See ${DOC_REF}.`;

export const formatIocGeneratedCradleDestructureError = (
  projectRoot: string,
  loc: FactorySourceLocation,
): string =>
  namedDepsBody(
    loc,
    `${formatFactoryLocation(projectRoot, loc.modulePath, loc.line)} destructures its first parameter as IocGeneratedCradle.`,
  );

export const formatInlineDepsTypeError = (
  projectRoot: string,
  loc: FactorySourceLocation,
): string =>
  namedDepsBody(
    loc,
    `${formatFactoryLocation(projectRoot, loc.modulePath, loc.line)} uses an inline object type as its first parameter.`,
  );

export const formatUnnamedDepsTypeError = (
  projectRoot: string,
  loc: FactorySourceLocation,
): string =>
  `[ioc] ${unitLabel(loc)} ${JSON.stringify(loc.exportName)} at ${formatFactoryLocation(projectRoot, loc.modulePath, loc.line)} must use a named local deps type (interface or type alias) for its first parameter.
Use a named local deps type instead:

${depsTypeHintBlock(loc)}

See ${DOC_REF}.`;

const isIocGeneratedCradleType = (
  checker: ts.TypeChecker,
  type: ts.Type,
): boolean => {
  const apparent = checker.getApparentType(type);
  let symbol = apparent.aliasSymbol ?? apparent.getSymbol();
  if (!symbol) {
    return false;
  }
  if (symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  return symbol.getName() === IOC_GENERATED_CRADLE_NAME;
};

const isNamedDepsTypeDeclaration = (
  checker: ts.TypeChecker,
  type: ts.Type,
): boolean => {
  const apparent = checker.getApparentType(type);
  let symbol = apparent.aliasSymbol ?? apparent.getSymbol();
  if (!symbol) {
    return false;
  }
  if (symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }

  const decl = symbol.declarations?.[0];
  if (!decl) {
    return false;
  }

  return ts.isInterfaceDeclaration(decl) || ts.isTypeAliasDeclaration(decl);
};

export type NamedDepsValidationResult =
  | { ok: true; depsType: ts.Type }
  | { ok: false; message: string };

/**
 * Validates the unit's first deps parameter uses a named local deps type (not IocGeneratedCradle or
 * an inline literal). `depsDecl` is the factory function or the class constructor — both are
 * `ts.FunctionLike`, so the rule and its diagnostics are shared.
 */
export const validateNamedDepsType = (
  checker: ts.TypeChecker,
  factoryDecl: ts.FunctionLike,
  projectRoot: string,
  loc: FactorySourceLocation,
): NamedDepsValidationResult => {
  const params = factoryDecl.parameters;
  const paramNode = params[0]!;
  const typeNode = paramNode.type;

  if (typeNode === undefined) {
    return {
      ok: false,
      message: formatUnnamedDepsTypeError(projectRoot, loc),
    };
  }

  if (ts.isTypeLiteralNode(typeNode)) {
    return {
      ok: false,
      message: formatInlineDepsTypeError(projectRoot, loc),
    };
  }

  const signature = checker.getSignatureFromDeclaration(factoryDecl);
  if (!signature) {
    return {
      ok: false,
      message: formatUnnamedDepsTypeError(projectRoot, loc),
    };
  }

  const paramSymbol = signature.getParameters()[0];
  if (!paramSymbol) {
    return {
      ok: false,
      message: formatUnnamedDepsTypeError(projectRoot, loc),
    };
  }

  const paramType = checker.getTypeOfSymbolAtLocation(paramSymbol, paramNode);
  const resolved = checker.getApparentType(paramType);

  if (isIocGeneratedCradleType(checker, resolved)) {
    return {
      ok: false,
      message: formatIocGeneratedCradleDestructureError(projectRoot, loc),
    };
  }

  if (!isNamedDepsTypeDeclaration(checker, resolved)) {
    return {
      ok: false,
      message: formatUnnamedDepsTypeError(projectRoot, loc),
    };
  }

  return { ok: true, depsType: resolved };
};
