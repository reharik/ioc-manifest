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

/**
 * The workspace's compiler options, minus everything that only describes an EMIT LAYOUT.
 *
 * Validate's program is synthetic and read-only: its roots are the generated registry-types files
 * of several packages at once, which is a shape no real build ever compiles. Options that
 * constrain where sources may live relative to an output directory then complain about validate's
 * own construction rather than about the files — `rootDir: packages/app/src` reports TS6059
 * against a composed package's registry file for the crime of not being under the app, which the
 * app's own `tsc` never says because it never makes that file a root.
 *
 * None of these affect how a name resolves or how two types compare, and nothing is emitted, so
 * dropping them narrows the diagnostics to what the integrity gate is actually about.
 */
const readOnlyProgramOptions = (
  options: ts.CompilerOptions,
): ts.CompilerOptions => {
  const {
    rootDir: _rootDir,
    rootDirs: _rootDirs,
    outDir: _outDir,
    outFile: _outFile,
    declarationDir: _declarationDir,
    composite: _composite,
    incremental: _incremental,
    tsBuildInfoFile: _tsBuildInfoFile,
    ...rest
  } = options;
  return { ...rest, noEmit: true, declaration: false, declarationMap: false };
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
      options: readOnlyProgramOptions(options),
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

/**
 * Diagnostic codes for unused declarations (`noUnusedLocals` / `noUnusedParameters`).
 *
 * Excluded from the integrity gate on purpose. An unused import cannot make a type unreadable —
 * it can never be why a comparison silently reads an error type, which is the whole reason this
 * gate exists. Failing validate on them would turn a style setting into a hard gate, and would be
 * a behavior delta for programs that are otherwise perfectly healthy.
 */
const UNUSED_DECLARATION_DIAGNOSTIC_CODES: ReadonlySet<number> = new Set([
  6133, 6138, 6192, 6196, 6198, 6199, 6205,
]);

/**
 * Errors in exactly the generated registry-types files validate reasons over.
 *
 * Deliberately NOT the whole program's diagnostics. Building a program over the registry files
 * pulls in their whole import closure — the consumer's own sources, `node_modules` typings, lib
 * files — and none of that is validate's business to adjudicate: a third-party `.d.ts` that a
 * consumer's own `tsc` tolerates (via `skipLibCheck`, a differing `lib`, or a path mapping we did
 * not replicate) must not fail their validate run. What IS validate's business is whether the
 * files it reads types OUT of hold together, because a name that does not resolve there becomes
 * an error type, and every assignability comparison involving an error type passes.
 *
 * Both syntactic and semantic diagnostics, filtered to error severity.
 */
export const collectRegistryFileDiagnostics = (
  ctx: ValidateTypeCheckerContext,
  typesPaths: readonly string[],
): Map<string, readonly ts.Diagnostic[]> => {
  const byPath = new Map<string, readonly ts.Diagnostic[]>();

  for (const typesPath of typesPaths) {
    const sourceFile = ctx.program.getSourceFile(typesPath);
    if (sourceFile === undefined) {
      // Not in the program at all. Nothing to prove either way here; the existing
      // "type could not be resolved" caveat already covers a key whose types never load.
      continue;
    }
    const diagnostics = [
      ...ctx.program.getSyntacticDiagnostics(sourceFile),
      ...ctx.program.getSemanticDiagnostics(sourceFile),
    ].filter(
      (d) =>
        d.category === ts.DiagnosticCategory.Error &&
        !UNUSED_DECLARATION_DIAGNOSTIC_CODES.has(d.code),
    );
    if (diagnostics.length > 0) {
      byPath.set(typesPath, diagnostics);
    }
  }

  return byPath;
};

/** One-line rendering of a diagnostic: `TS2304: Cannot find name 'MissingLogger'. (line 2)`. */
export const formatRegistryDiagnostic = (diagnostic: ts.Diagnostic): string => {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  if (diagnostic.file === undefined || diagnostic.start === undefined) {
    return `TS${diagnostic.code}: ${message}`;
  }
  const { line } = diagnostic.file.getLineAndCharacterOfPosition(
    diagnostic.start,
  );
  return `TS${diagnostic.code}: ${message} (line ${line + 1})`;
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
