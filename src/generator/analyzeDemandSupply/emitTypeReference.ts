import path from "node:path";
import ts from "typescript";
import {
  computeManifestModuleSpecifier,
  type FactoryDiscoveryPaths,
} from "../manifestPaths.js";
import {
  factoryBareImportLocalBindingName,
  factoryImportsTypeAsDefaultBareImport,
  tryRecoverPreferredModuleSpecifier,
} from "../recoverPreferredModuleSpecifier.js";
import { cradleTypeImportUsesDefaultExport } from "../contractTypeSourceFile.js";
import type { EmittedTypeReference, TypeImportSpec } from "./types.js";

const NO_TRUNCATION = ts.TypeFormatFlags.NoTruncation;

const TYPESCRIPT_LIB_DIR_MARKER = `${path.sep}typescript${path.sep}lib${path.sep}`;

export class EmitTypeReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmitTypeReferenceError";
  }
}

const formatType = (checker: ts.TypeChecker, type: ts.Type): string =>
  checker.typeToString(type, undefined, NO_TRUNCATION);

/** Primitive `object` (not the lib `Object` interface). */
const isPrimitiveObjectType = (type: ts.Type): boolean =>
  (type.flags & ts.TypeFlags.Object) !== 0 &&
  (type.flags & ts.TypeFlags.NonPrimitive) === 0;

const hasLiteralTypeFlags = (type: ts.Type): boolean =>
  (type.flags &
    (ts.TypeFlags.StringLiteral |
      ts.TypeFlags.NumberLiteral |
      ts.TypeFlags.BooleanLiteral |
      ts.TypeFlags.EnumLiteral)) !==
  0;

const primitiveKeywordFromFlags = (type: ts.Type): string | undefined => {
  const flags = type.flags;
  if (flags & ts.TypeFlags.Undefined) {
    return "undefined";
  }
  if (flags & ts.TypeFlags.Null) {
    return "null";
  }
  if (flags & ts.TypeFlags.Void) {
    return "void";
  }
  if (flags & ts.TypeFlags.Never) {
    return "never";
  }
  if (flags & ts.TypeFlags.Unknown) {
    return "unknown";
  }
  if (flags & ts.TypeFlags.Any) {
    return "any";
  }
  if (flags & ts.TypeFlags.String) {
    return "string";
  }
  if (flags & ts.TypeFlags.Number) {
    return "number";
  }
  if (flags & ts.TypeFlags.Boolean) {
    return "boolean";
  }
  if (flags & ts.TypeFlags.BigInt) {
    return "bigint";
  }
  if (flags & ts.TypeFlags.ESSymbol) {
    return "symbol";
  }
  return undefined;
};

/**
 * Maps lib intrinsic object types (`String`, `Number`, …) and keyword `object` to lowercase primitives.
 * The lib `Object` interface is excluded (handled by {@link isGlobalLibType}).
 */
const primitiveKeywordFromObjectType = (
  checker: ts.TypeChecker,
  type: ts.Type,
): string | undefined => {
  if (!isPrimitiveObjectType(type)) {
    return undefined;
  }
  const symName = type.getSymbol()?.getName();
  if (symName === "String") {
    return "string";
  }
  if (symName === "Number") {
    return "number";
  }
  if (symName === "Boolean") {
    return "boolean";
  }
  if (symName === "BigInt") {
    return "bigint";
  }
  if (symName === "Symbol") {
    return "symbol";
  }
  if (symName === undefined || symName === "object") {
    const display = formatType(checker, type);
    if (display.startsWith("[")) {
      return display;
    }
    return "object";
  }
  return undefined;
};

const tryPrimitiveInlineText = (
  checker: ts.TypeChecker,
  type: ts.Type,
): string | undefined =>
  primitiveKeywordFromFlags(type) ??
  primitiveKeywordFromObjectType(checker, type);

const isTypescriptLibDeclarationPath = (fileName: string): boolean =>
  path.normalize(fileName).includes(TYPESCRIPT_LIB_DIR_MARKER);

const assertNotTypescriptPackageImport = (
  typeName: string,
  relImport: string,
  declarationFileName: string,
): void => {
  if (
    relImport === "typescript" ||
    isTypescriptLibDeclarationPath(declarationFileName)
  ) {
    throw new EmitTypeReferenceError(
      `[ioc] Codegen attempted to import ${JSON.stringify(typeName)} from the typescript package's lib files. This is a bug in ioc-manifest. Please file an issue with the factory and deps type that triggered this.`,
    );
  }
};

const getTypeDeclarationSourceFile = (
  checker: ts.TypeChecker,
  type: ts.Type,
): ts.SourceFile | undefined => {
  const t = checker.getApparentType(type);

  if (t.isUnion() || t.isIntersection()) {
    return undefined;
  }

  let symbol = t.aliasSymbol ?? t.getSymbol();
  if (!symbol) {
    return undefined;
  }

  if (symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }

  const decl = symbol.declarations?.[0];
  if (!decl) {
    return undefined;
  }

  return decl.getSourceFile();
};

const isGlobalLibType = (
  program: ts.Program,
  checker: ts.TypeChecker,
  type: ts.Type,
): boolean => {
  const declSource = getTypeDeclarationSourceFile(checker, type);
  if (declSource === undefined) {
    return false;
  }
  return program.isSourceFileDefaultLibrary(declSource);
};

const importSymbolNameFromType = (
  checker: ts.TypeChecker,
  type: ts.Type,
): string | undefined => {
  const t = checker.getApparentType(type);
  if (t.isUnion() || t.isIntersection()) {
    return undefined;
  }

  const symbol = t.aliasSymbol ?? t.getSymbol();
  if (!symbol) {
    return undefined;
  }

  const name = symbol.getName();
  return name.length > 0 ? name : undefined;
};

const mergeImports = (specs: readonly TypeImportSpec[]): TypeImportSpec[] => {
  const seen = new Set<string>();
  const out: TypeImportSpec[] = [];
  for (const spec of specs) {
    const key = `${spec.relImport}\0${spec.typeName}\0${spec.useDefaultImport}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(spec);
    }
  }
  return out;
};

const inlineResult = (
  checker: ts.TypeChecker,
  type: ts.Type,
): { typeName: string; imports: TypeImportSpec[] } => {
  const primitiveText = tryPrimitiveInlineText(checker, type);
  return {
    typeName: primitiveText ?? formatType(checker, type),
    imports: [],
  };
};

type EmitInnerResult = {
  typeName: string;
  imports: TypeImportSpec[];
};

const emitNamedTypeImport = (
  checker: ts.TypeChecker,
  type: ts.Type,
  ctx: EmitTypeReferenceContext,
  compoundContext?: { compoundDisplay: string },
): EmitInnerResult => {
  const apparent = checker.getApparentType(type);
  const typeDisplay = formatType(checker, apparent);
  let importName = importSymbolNameFromType(checker, apparent);
  if (importName === "default") {
    const localName = factoryBareImportLocalBindingName(
      checker,
      apparent,
      ctx.contextSourceFile,
    );
    if (localName !== undefined) {
      importName = localName;
    }
  }
  const declSource = getTypeDeclarationSourceFile(checker, apparent);

  if (
    declSource !== undefined &&
    path.normalize(declSource.fileName) ===
      path.normalize(ctx.contextSourceFile.fileName)
  ) {
    return inlineResult(checker, apparent);
  }

  if (importName === undefined || declSource === undefined) {
    const compoundSuffix =
      compoundContext !== undefined
        ? ` in compound type ${JSON.stringify(compoundContext.compoundDisplay)}`
        : "";
    throw new EmitTypeReferenceError(
      `[ioc] Cannot resolve import for type ${JSON.stringify(typeDisplay)}${compoundSuffix}`,
    );
  }

  const relImport = computeManifestModuleSpecifier(
    declSource.fileName,
    ctx.generatedDir,
    ctx.scanDirs,
    {
      preferredModuleSpecifier: tryRecoverPreferredModuleSpecifier(
        checker,
        apparent,
        ctx.contextSourceFile,
      ),
      projectRoot: ctx.projectRoot,
    },
  );

  assertNotTypescriptPackageImport(importName, relImport, declSource.fileName);

  const useDefaultImport =
    factoryImportsTypeAsDefaultBareImport(
      checker,
      apparent,
      ctx.contextSourceFile,
    ) ||
    (cradleTypeImportUsesDefaultExport(declSource, importName) ?? false);

  return {
    typeName: importName,
    imports: [{ typeName: importName, relImport, useDefaultImport }],
  };
};

const orderUnionPartTexts = (parts: string[]): string[] => {
  const out = [...parts];
  for (const trailing of ["null", "undefined"]) {
    const idx = out.indexOf(trailing);
    if (idx >= 0) {
      out.splice(idx, 1);
      out.push(trailing);
    }
  }
  return out;
};

const emitCompoundType = (
  checker: ts.TypeChecker,
  members: readonly ts.Type[],
  separator: " | " | " & ",
  compoundType: ts.Type,
  ctx: EmitTypeReferenceContext,
): EmitInnerResult => {
  const compoundDisplay = formatType(checker, compoundType);
  const parts: string[] = [];
  const imports: TypeImportSpec[] = [];

  for (const member of members) {
    const memberDisplay = formatType(checker, member);
    try {
      const part = emitTypeReferenceInner(checker, member, ctx, {
        compoundDisplay,
      });
      parts.push(part.typeName);
      imports.push(...part.imports);
    } catch (err) {
      if (err instanceof EmitTypeReferenceError) {
        throw err;
      }
      throw new EmitTypeReferenceError(
        `[ioc] Cannot resolve import for type ${JSON.stringify(memberDisplay)} in compound type ${JSON.stringify(compoundDisplay)}`,
      );
    }
  }

  const typeName =
    separator === " | "
      ? orderUnionPartTexts(parts).join(separator)
      : parts.join(separator);

  return {
    typeName,
    imports: mergeImports(imports),
  };
};

const emitTypeReferenceInner = (
  checker: ts.TypeChecker,
  type: ts.Type,
  ctx: EmitTypeReferenceContext,
  compoundContext?: { compoundDisplay: string },
): EmitInnerResult => {
  if (type.flags & ts.TypeFlags.TypeParameter) {
    const typeDisplay = formatType(checker, type);
    const compoundSuffix =
      compoundContext !== undefined
        ? ` in compound type ${JSON.stringify(compoundContext.compoundDisplay)}`
        : "";
    throw new EmitTypeReferenceError(
      `[ioc] Cannot resolve import for type ${JSON.stringify(typeDisplay)}${compoundSuffix}`,
    );
  }

  const apparent = checker.getApparentType(type);

  if (apparent.isUnion()) {
    return emitCompoundType(
      checker,
      apparent.types,
      " | ",
      apparent,
      ctx,
    );
  }

  if (apparent.isIntersection()) {
    return emitCompoundType(
      checker,
      apparent.types,
      " & ",
      apparent,
      ctx,
    );
  }

  if (tryPrimitiveInlineText(checker, apparent) !== undefined) {
    return inlineResult(checker, apparent);
  }

  if (hasLiteralTypeFlags(apparent)) {
    return inlineResult(checker, apparent);
  }

  if (isGlobalLibType(ctx.program, checker, apparent)) {
    return inlineResult(checker, apparent);
  }

  return emitNamedTypeImport(checker, apparent, ctx, compoundContext);
};

export type EmitTypeReferenceContext = FactoryDiscoveryPaths & {
  program: ts.Program;
  projectRoot: string;
  contextSourceFile: ts.SourceFile;
};

export type TryEmitTypeReferenceOptions = {
  propertyName?: string;
};

export const tryEmitTypeReference = (
  checker: ts.TypeChecker,
  type: ts.Type,
  ctx: EmitTypeReferenceContext,
  options?: TryEmitTypeReferenceOptions,
): { ok: true; value: EmittedTypeReference } | { ok: false; message: string } => {
  try {
    const inner = emitTypeReferenceInner(checker, type, ctx);
    return {
      ok: true,
      value: { typeName: inner.typeName, imports: inner.imports },
    };
  } catch (err) {
    if (err instanceof EmitTypeReferenceError) {
      const suffix =
        options?.propertyName !== undefined
          ? ` on property ${JSON.stringify(options.propertyName)}`
          : "";
      return { ok: false, message: `${err.message}${suffix}` };
    }
    throw err;
  }
};

/**
 * Maps a TypeScript type to an importable type name and module specifier for generated registry types.
 */
export const emitTypeReference = (
  checker: ts.TypeChecker,
  type: ts.Type,
  ctx: EmitTypeReferenceContext,
): EmittedTypeReference | undefined => {
  const result = tryEmitTypeReference(checker, type, ctx);
  return result.ok ? result.value : undefined;
};

export const formatTypeDisplay = (
  checker: ts.TypeChecker,
  type: ts.Type,
): string => formatType(checker, type);

export const isUnresolvableDepsPropertyType = (
  checker: ts.TypeChecker,
  type: ts.Type,
  ctx: EmitTypeReferenceContext,
): boolean => {
  const apparent = checker.getApparentType(type);
  if (apparent.flags & (ts.TypeFlags.Any | ts.TypeFlags.TypeParameter)) {
    return true;
  }
  return !tryEmitTypeReference(checker, type, ctx).ok;
};
