/**
 * @fileoverview Import-closure verification for emitted type text.
 *
 * The emitter's contract is: **every type name it prints must be import-closed** — either emitted
 * by reference to a specifier the generated file imports, or not printed at all. Reference-emission
 * (see {@link import("./emitTypeReference.js")}) is the primary way that holds. This module is the
 * backstop for the one path that legitimately still prints structure: a genuinely anonymous type
 * (an inline object literal or an unnamed intersection member) has no name to reference, so its
 * shape is rendered by `typeToString` and its field types are imported separately.
 *
 * Those two are computed by different traversals and can therefore disagree — the rendered text
 * spells out type arguments and computed-property brands that the import walk never visits. That
 * disagreement is what shipped a non-compiling `ioc-registry.types.ts` to a consumer. So the text
 * is re-parsed here and every name in it is checked against what the file will actually import,
 * declare, or inherit from the global lib; anything left over is a HARD ERROR at generation.
 *
 * There is deliberately no fallback. "Print it and hope the consumer's tsc agrees" is removed as a
 * behavior, not patched per trigger.
 */
import path from "node:path";
import ts from "typescript";
import { registryTypesFilePath } from "../manifestPaths.js";
import type { EmittedTypeReference, TypeImportSpec } from "./types.js";

/**
 * A printed type reference the generated file could not resolve. Deliberately NOT a subclass of
 * `EmitTypeReferenceError`: that class means "no importable reference exists for this type", which
 * callers legitimately soften into a contract-name fallback or an `undefined` return. A closure
 * violation means "the text we were about to write does not compile", which nothing may soften.
 */
export class EmitImportClosureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmitImportClosureError";
  }
}

/** Names `writeManifest` always declares at the top level of the generated registry-types file. */
const ALWAYS_DECLARED_IN_REGISTRY = [
  "IocGeneratedCradle",
  "IocExternals",
  "IocScopeProvided",
] as const;

/**
 * Per-program memo. Verification runs once per emitted property, so the two expensive answers —
 * the global scope and module resolution — are computed once per program and reused. Keyed by
 * program because that is what makes them valid; nothing here survives a new program.
 */
type ProgramCaches = {
  globalNames?: ReadonlySet<string>;
  registryNames: Map<string, ReadonlySet<string>>;
  moduleExports: Map<string, ReadonlySet<string> | undefined>;
  moduleResolution: ts.ModuleResolutionCache;
};

const cachesByProgram = new WeakMap<ts.Program, ProgramCaches>();

const cachesFor = (program: ts.Program): ProgramCaches => {
  const existing = cachesByProgram.get(program);
  if (existing !== undefined) {
    return existing;
  }
  const fresh: ProgramCaches = {
    registryNames: new Map(),
    moduleExports: new Map(),
    moduleResolution: ts.createModuleResolutionCache(
      program.getCurrentDirectory(),
      (f) => f,
      program.getCompilerOptions(),
    ),
  };
  cachesByProgram.set(program, fresh);
  return fresh;
};

/**
 * Every name visible in the global scope (lib `Date`, `Promise`, `Record`, `ReadonlyArray`, plus
 * whatever ambient declarations the program pulls in). Asked of a default-library file so the
 * answer is globals only, and cached per program because the emitter calls this per property.
 */
const globalScopeNames = (
  program: ts.Program,
  checker: ts.TypeChecker,
): ReadonlySet<string> => {
  const caches = cachesFor(program);
  if (caches.globalNames !== undefined) {
    return caches.globalNames;
  }
  const names = new Set<string>();
  const libFile = program
    .getSourceFiles()
    .find((f) => program.isSourceFileDefaultLibrary(f));
  if (libFile !== undefined) {
    for (const sym of checker.getSymbolsInScope(
      libFile,
      ts.SymbolFlags.Type | ts.SymbolFlags.Namespace | ts.SymbolFlags.Value,
    )) {
      names.add(sym.getName());
    }
  }
  caches.globalNames = names;
  return names;
};

/** Top-level type/value names the previous generation of the registry-types file declares. */
const registryFileDeclaredNames = (
  program: ts.Program,
  generatedDir: string,
): ReadonlySet<string> => {
  const caches = cachesFor(program);
  const cached = caches.registryNames.get(generatedDir);
  if (cached !== undefined) {
    return cached;
  }
  const names = new Set<string>(ALWAYS_DECLARED_IN_REGISTRY);
  caches.registryNames.set(generatedDir, names);
  const registry = program.getSourceFile(registryTypesFilePath(generatedDir));
  if (registry === undefined) {
    return names;
  }
  for (const stmt of registry.statements) {
    if (
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isInterfaceDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt) ||
      ts.isClassDeclaration(stmt)
    ) {
      if (stmt.name !== undefined) {
        names.add(stmt.name.text);
      }
    }
  }
  return names;
};

const leftmostIdentifier = (name: ts.EntityName): string | undefined => {
  let node: ts.EntityName = name;
  while (ts.isQualifiedName(node)) {
    node = node.left;
  }
  return ts.isIdentifier(node) ? node.text : undefined;
};

type ProbeResult = {
  /** Root identifiers the printed text references and the file must therefore resolve. */
  referenced: Set<string>;
  /** Syntax errors from re-parsing the printed text, if it is not a well-formed type. */
  parseErrors: readonly string[];
  /** True when the text embeds an inline `import("…")` type, which is never emitted by design. */
  hasInlineImportType: boolean;
};

/**
 * Re-parses printed type text and collects the names it depends on.
 *
 * The text is what will land in the generated file verbatim, so parsing it is the only honest way
 * to enumerate its references: a hand-rolled scan over identifiers would count property names and
 * string literals, and a walk of the original `ts.Type` would count what the type IS rather than
 * what was printed — and it is precisely the gap between those two that this module exists to close.
 */
const probePrintedText = (text: string): ProbeResult => {
  const referenced = new Set<string>();
  const probe = ts.createSourceFile(
    "__ioc_emit_probe.ts",
    `type __IocEmitProbe = ${text};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const parseErrors = (
    probe as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] }
  ).parseDiagnostics?.map((d) =>
    ts.flattenDiagnosticMessageText(d.messageText, " "),
  );

  let hasInlineImportType = false;
  const visit = (node: ts.Node): void => {
    if (ts.isImportTypeNode(node)) {
      hasInlineImportType = true;
    } else if (ts.isTypeReferenceNode(node)) {
      const root = leftmostIdentifier(node.typeName);
      if (root !== undefined) {
        referenced.add(root);
      }
    } else if (ts.isTypeQueryNode(node)) {
      // `typeof X` — the printed form for a `unique symbol` brand held in a const.
      const root = leftmostIdentifier(node.exprName);
      if (root !== undefined) {
        referenced.add(root);
      }
    } else if (ts.isComputedPropertyName(node) && ts.isIdentifier(node.expression)) {
      // `{ readonly [brand]: "UserId" }` — `brand` is a VALUE the generated file must also resolve.
      referenced.add(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(probe);

  return {
    referenced,
    parseErrors: parseErrors ?? [],
    hasInlineImportType,
  };
};

const moduleSourceFileForSpecifier = (
  program: ts.Program,
  containingFile: string,
  specifier: string,
): ts.SourceFile | undefined => {
  const resolved = ts.resolveModuleName(
    specifier,
    containingFile,
    program.getCompilerOptions(),
    ts.sys,
    cachesFor(program).moduleResolution,
  ).resolvedModule?.resolvedFileName;
  if (resolved !== undefined) {
    const sf = program.getSourceFile(resolved);
    if (sf !== undefined) {
      return sf;
    }
  }
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  // Fallback for module modes that will not rewrite the emitted `.js` extension back to a source
  // file: try the sibling `.ts`/`.tsx`/`.d.ts` directly against the program.
  const abs = path.resolve(path.dirname(containingFile), specifier);
  const base = abs.replace(/\.(?:m|c)?jsx?$/, "");
  for (const ext of [".ts", ".tsx", ".d.ts", ".mts", ".cts"]) {
    const sf = program.getSourceFile(`${base}${ext}`);
    if (sf !== undefined) {
      return sf;
    }
  }
  return undefined;
};

/**
 * Names a module actually exports, or `undefined` when the module cannot be resolved against this
 * program. `undefined` is not a failure: it means we cannot PROVE the import is broken (the
 * specifier may resolve only in the consumer's own program), and this check never guesses.
 */
const exportedNamesOfSpecifier = (
  program: ts.Program,
  checker: ts.TypeChecker,
  containingFile: string,
  specifier: string,
): ReadonlySet<string> | undefined => {
  const caches = cachesFor(program);
  const key = `${containingFile}\0${specifier}`;
  if (caches.moduleExports.has(key)) {
    return caches.moduleExports.get(key);
  }

  const sf = moduleSourceFileForSpecifier(program, containingFile, specifier);
  const moduleSymbol =
    sf !== undefined ? checker.getSymbolAtLocation(sf) : undefined;
  const names =
    moduleSymbol !== undefined
      ? new Set(checker.getExportsOfModule(moduleSymbol).map((s) => s.getName()))
      : undefined;
  caches.moduleExports.set(key, names);
  return names;
};

const quoteList = (names: Iterable<string>): string =>
  Array.from(names)
    .sort((a, b) => a.localeCompare(b))
    .map((n) => JSON.stringify(n))
    .join(", ");

const positionSuffix = (position: string | undefined): string =>
  position !== undefined ? ` at ${position}` : "";

const closureFailure = (
  reason: string,
  hint: string,
  typeName: string,
  position: string | undefined,
): EmitImportClosureError =>
  new EmitImportClosureError(
    `[ioc] Refusing to emit a type the generated registry file could not compile${positionSuffix(position)}.\n` +
      `  emitted type text: ${typeName}\n` +
      `  ${reason}\n` +
      `  ${hint}`,
  );

/** Offered when structure was printed because nothing named the type. */
const NAME_THE_TYPE_HINT =
  "Every name the generated file prints must be import-closed. Give this type an exported name " +
  "and annotate with that name, so codegen emits it by reference instead of expanding its structure.";

export type VerifyImportClosureContext = {
  program: ts.Program;
  generatedDir: string;
};

/**
 * Hard-errors unless every name in {@link emitted}'s printed text resolves in the generated file.
 *
 * Checked, in order: the text parses as a type; it embeds no inline `import(…)`; every referenced
 * root name is imported / locally declared / global; and every collected import specifier that this
 * program can resolve really exports the name being imported (the package-root trap — a name
 * declared in `pkg/dist/sub.d.ts` is NOT importable from `"pkg"` unless the root re-exports it).
 */
export const verifyImportClosure = (
  emitted: EmittedTypeReference,
  ctx: VerifyImportClosureContext,
  position?: string,
): void => {
  const { program, generatedDir } = ctx;
  const checker = program.getTypeChecker();
  const containingFile = registryTypesFilePath(generatedDir);

  const probe = probePrintedText(emitted.typeName);
  if (probe.parseErrors.length > 0) {
    throw closureFailure(
      `the text is not a well-formed TypeScript type (${probe.parseErrors.join("; ")}).`,
      "This is a bug in ioc-manifest. Please file an issue with the contract that triggered it.",
      emitted.typeName,
      position,
    );
  }
  if (probe.hasInlineImportType) {
    throw closureFailure(
      `the text embeds an inline \`import("…")\` type, which pins a path that is only valid in the ` +
        `analyzing program.`,
      NAME_THE_TYPE_HINT,
      emitted.typeName,
      position,
    );
  }

  const known = new Set<string>([
    ...globalScopeNames(program, checker),
    ...registryFileDeclaredNames(program, generatedDir),
  ]);
  for (const imp of emitted.imports) {
    known.add(imp.typeName);
  }

  const unresolvable = Array.from(probe.referenced).filter(
    (name) => !known.has(name),
  );
  if (unresolvable.length > 0) {
    throw closureFailure(
      `the generated file would reference ${quoteList(unresolvable)} with no import that binds ` +
        `${unresolvable.length === 1 ? "it" : "them"} (TS2304).`,
      NAME_THE_TYPE_HINT,
      emitted.typeName,
      position,
    );
  }

  const notExported: { spec: TypeImportSpec; specifier: string }[] = [];
  const exportsBySpecifier = new Map<string, ReadonlySet<string> | undefined>();
  for (const imp of emitted.imports) {
    if (!exportsBySpecifier.has(imp.relImport)) {
      exportsBySpecifier.set(
        imp.relImport,
        exportedNamesOfSpecifier(program, checker, containingFile, imp.relImport),
      );
    }
    const exported = exportsBySpecifier.get(imp.relImport);
    if (exported === undefined) {
      continue;
    }
    const wanted = imp.useDefaultImport ? "default" : imp.typeName;
    if (!exported.has(wanted)) {
      notExported.push({ spec: imp, specifier: imp.relImport });
    }
  }
  if (notExported.length > 0) {
    const detail = notExported
      .map(
        ({ spec, specifier }) =>
          `${JSON.stringify(spec.typeName)} from ${JSON.stringify(specifier)}`,
      )
      .sort((a, b) => a.localeCompare(b))
      .join(", ");
    throw closureFailure(
      `the generated file would import ${detail}, which ${notExported.length === 1 ? "that module does" : "those modules do"} not export (TS2305).`,
      "Export the name from the module it is imported from (or re-export it from that package's " +
        "entry point), then re-run generation.",
      emitted.typeName,
      position,
    );
  }
};
