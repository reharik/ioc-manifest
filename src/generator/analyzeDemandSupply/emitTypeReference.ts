import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  computeManifestModuleSpecifier,
  registryTypesFilePath,
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

/**
 * Canonical absolute path for cross-comparison. `declSource.fileName` is TS's absolute
 * realpath, but `generatedDir` can be project-relative in a composed run, so both sides
 * must be resolved to the same shape. Resolve against cwd (matching how `generatedDir` is
 * used elsewhere — `fs.mkdir(generatedDir)`, `path.relative`), then `realpath` to reconcile
 * monorepo/pnpm symlinks. Falls back to the resolved (non-realpath) path when the target
 * file does not exist yet (the generated file may not be on disk during the first run).
 */
const canonicalPath = (p: string): string => {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync.native(abs);
  } catch {
    return abs;
  }
};

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

/** True when the type is declared as a top-level type alias, interface, or enum in source. */
const isTopLevelNamedTypeDeclaration = (
  type: ts.Type,
  importName: string,
): boolean => {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  if (symbol === undefined) {
    return false;
  }
  for (const decl of symbol.declarations ?? []) {
    if (
      (ts.isTypeAliasDeclaration(decl) ||
        ts.isInterfaceDeclaration(decl) ||
        ts.isEnumDeclaration(decl)) &&
      decl.name.text === importName
    ) {
      return true;
    }
  }
  return false;
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

/**
 * The number of type parameters declared by the symbol whose NAME we print for a
 * reference. This is the arity of the printed name, which may differ from the number
 * of arguments {@link ts.TypeChecker.getTypeArguments} reports for the resolved type
 * (e.g. `type KnexConfig = Cfg<SV extends {} = any>` resolves to `Cfg<any>` but the
 * alias `KnexConfig` is itself non-generic).
 */
const declaredTypeParameterArity = (symbol: ts.Symbol | undefined): number => {
  const decl = symbol?.declarations?.[0];
  if (decl === undefined) {
    return 0;
  }
  if (
    ts.isTypeAliasDeclaration(decl) ||
    ts.isInterfaceDeclaration(decl) ||
    ts.isClassDeclaration(decl)
  ) {
    return decl.typeParameters?.length ?? 0;
  }
  return 0;
};

/** The symbol whose name {@link emitNamedTypeImport} prints (matches importSymbolNameFromType). */
const printedNameSymbol = (
  checker: ts.TypeChecker,
  type: ts.Type,
): ts.Symbol | undefined => {
  const t = checker.getApparentType(type);
  return t.aliasSymbol ?? t.getSymbol();
};

const emitTypeArgumentList = (
  checker: ts.TypeChecker,
  type: ts.Type,
  ctx: EmitTypeReferenceContext,
  compoundContext?: { compoundDisplay: string },
): { text: string; imports: TypeImportSpec[] } | undefined => {
  if ((type.flags & ts.TypeFlags.Object) === 0) {
    return undefined;
  }
  if (
    ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) === 0
  ) {
    return undefined;
  }
  const args = checker.getTypeArguments(type as ts.TypeReference);
  if (args.length === 0) {
    return undefined;
  }

  // Render args against the arity of the printed name, not the resolved type's arg
  // count. An alias may carry more args (from a generic's defaults) than its own name
  // accepts; emitting them yields `KnexConfig<any>` on a non-generic alias (TS2315).
  const arity = declaredTypeParameterArity(printedNameSymbol(checker, type));
  if (arity === 0) {
    return undefined;
  }

  // Invariant: arg count emitted == arity of the printed name, and every emitted arg
  // is concrete. Clamp to the first `arity` args (ignore any extras); if any of those
  // is a bare, unresolved type parameter, emit the bare name rather than recursing
  // (recursion throws on a type parameter) or synthesizing an argument.
  const clampedArgs = args.slice(0, arity);
  if (
    clampedArgs.some((arg) => (arg.flags & ts.TypeFlags.TypeParameter) !== 0)
  ) {
    return undefined;
  }

  const parts: string[] = [];
  const imports: TypeImportSpec[] = [];
  for (const arg of clampedArgs) {
    const emitted = emitTypeReferenceInner(checker, arg, ctx, compoundContext);
    parts.push(emitted.typeName);
    imports.push(...emitted.imports);
  }
  return { text: `<${parts.join(", ")}>`, imports };
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

  // Same-file guard: when a factory imports a name that resolves to a type declared in the
  // generated registry-types output itself (a group alias like `FastSweepNotificationStrategies`,
  // or `IocGeneratedCradle` / `IocExternals` / `IocScopeProvided`), regen must not import that file
  // into itself. A self-import reserves the name, which suppresses the alias's own `export type`
  // declaration and defeats the self-import strip (TS2303/TS2459). Emit the bare LOCAL name with no
  // import spec — a type declared in the generated output is always a local reference.
  if (
    declSource !== undefined &&
    importName !== undefined &&
    canonicalPath(declSource.fileName) ===
      canonicalPath(registryTypesFilePath(ctx.generatedDir))
  ) {
    return { typeName: importName, imports: [] };
  }

  // Top-level named types declared in the factory file still require imports because the
  // generated output file is generated/ioc-registry.types.ts, not the factory file.
  // Inlining is reserved for primitives, literals, lib globals (handled above), and anonymous
  // structural types that only exist inline in the factory file.
  if (
    declSource !== undefined &&
    importName !== undefined &&
    path.normalize(declSource.fileName) ===
      path.normalize(ctx.contextSourceFile.fileName) &&
    !isTopLevelNamedTypeDeclaration(apparent, importName)
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

  const base: EmitInnerResult = {
    typeName: importName,
    imports: [{ typeName: importName, relImport, useDefaultImport }],
  };

  const typeArgs = emitTypeArgumentList(checker, apparent, ctx, compoundContext);
  if (typeArgs === undefined) {
    return base;
  }
  return {
    typeName: `${base.typeName}${typeArgs.text}`,
    imports: mergeImports([...base.imports, ...typeArgs.imports]),
  };
};

/** Drop duplicate identical rendered members, preserving first-occurrence order. */
const dedupePartTexts = (parts: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    if (!seen.has(part)) {
      seen.add(part);
      out.push(part);
    }
  }
  return out;
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

  // Collapse identical members (`A | A` → `A`, `A & A` → `A`); a factory typed
  // `AwilixContainer<IocGeneratedCradle>` composed across manifests otherwise renders
  // `IocGeneratedCradle & IocGeneratedCradle & …`. Dedup before union ordering.
  const dedupedParts = dedupePartTexts(parts);
  const typeName =
    separator === " | "
      ? orderUnionPartTexts(dedupedParts).join(separator)
      : dedupedParts.join(separator);

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

  // Literal types must be inlined from the un-widened type: getApparentType widens a
  // string/number/boolean literal to its primitive (`"a"` -> `String`), so this check has
  // to run before apparent narrowing to preserve narrowed literal type arguments in the cradle.
  if (hasLiteralTypeFlags(type)) {
    return inlineResult(checker, type);
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
