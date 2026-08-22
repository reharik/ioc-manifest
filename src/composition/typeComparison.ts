/**
 * @fileoverview Type-level comparison helpers for the composition checks.
 *
 * Reads types out of the ONE program `createCompositionProgram` builds — never its own. A second
 * program could disagree with the one whose health the integrity gate just adjudicated, and a
 * program built differently from the app's build is exactly the defect that made these
 * comparisons untrustworthy in the first place (see `compositionProgram.ts`).
 */
import ts from "typescript";
import type { CompositionProgramContext } from "./compositionProgram.js";

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
 * Errors in exactly the generated registry-types files the composition checks reason over.
 *
 * Deliberately NOT the whole program's diagnostics. The composition program roots the app's entire
 * source set and pulls in its whole import closure — the consumer's own sources, `node_modules`
 * typings, lib files — and none of that is this gate's business to adjudicate: a third-party
 * `.d.ts` that the consumer's own `tsc` tolerates (via `skipLibCheck`, a differing `lib`, or a
 * path mapping we did not replicate) must not fail their run, and in generate it must not refuse
 * to emit. What IS this gate's business is whether the files it reads types OUT of hold together,
 * because a name that does not resolve there becomes an error type, and every assignability
 * comparison involving an error type passes.
 *
 * Both syntactic and semantic diagnostics, filtered to error severity.
 */
export const collectRegistryFileDiagnostics = (
  ctx: CompositionProgramContext,
  typesPaths: readonly string[],
): Map<string, readonly ts.Diagnostic[]> => {
  const byPath = new Map<string, readonly ts.Diagnostic[]>();

  for (const typesPath of typesPaths) {
    const sourceFile = ctx.program.getSourceFile(ctx.canonicalPathFor(typesPath));
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
  ctx: CompositionProgramContext,
  typesPath: string,
  interfaceName: string,
  propertyKey: string,
): ts.Type | undefined => {
  const sourceFile = ctx.program.getSourceFile(ctx.canonicalPathFor(typesPath));
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
  ctx: CompositionProgramContext,
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
