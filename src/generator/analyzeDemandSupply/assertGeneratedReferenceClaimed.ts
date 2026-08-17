/**
 * @fileoverview The structural backstop for the closure-by-enumeration invariant documented in
 * `generatedReferenceForms.ts`.
 *
 * `validateGeneratedReferencesAtCodegen` rejects the reference forms that are recognizable from a
 * single scanned file. What it cannot see is CONTEXT: `ReadonlyArray<Cradle["storage"]>` and a bare
 * `IocGeneratedCradle` are both fine where they only get printed back — the documented
 * composition-root pattern — and both are wrong in a factory deps type or return type, where the
 * type is read member-by-member to build the new cradle. This module supplies the missing half:
 * immediately before demand analysis would hand a type to the checker, it asserts syntactically
 * that nothing reaching the generated registry file went unclaimed.
 *
 * Anything found here is a form the resolver did not claim, so letting it through would mean
 * type-resolving the generated file: stale types on a warm run, `any` on a cold one. It is
 * therefore an error, never a warning. Like every other check on this path, it is purely syntactic
 * — the generated file is never read.
 */
import path from "node:path";
import ts from "typescript";
import {
  collectGeneratedRegistryBindings,
  resolveGeneratedBindingReference,
} from "../generatedRegistryBindings.js";
import { formatRejectedGeneratedReference } from "../generatedReferenceForms.js";
import { moduleSpecifierTargetsGeneratedRegistry } from "../generatedRegistrySpecifier.js";
import { isGeneratedRegistrySourceFile } from "./resolveIocGeneratedCradleIndexedAccess.js";

/** How many type-alias indirections are followed before the walk gives up. */
const MAX_ALIAS_HOPS = 8;

type GeneratedBindingsOfFile = ReturnType<typeof collectGeneratedRegistryBindings>;

export type UnclaimedGeneratedReference = {
  readonly node: ts.Node;
  readonly sourceFile: ts.SourceFile;
};

const bindingsForFile = (
  sourceFile: ts.SourceFile,
  generatedDir: string,
): GeneratedBindingsOfFile =>
  collectGeneratedRegistryBindings(
    sourceFile,
    path.resolve(sourceFile.fileName),
    generatedDir,
  );

/** The entity name a type node references, when it is a plain type reference or `typeof` query. */
const referencedEntityName = (node: ts.Node): ts.EntityName | undefined => {
  if (ts.isTypeReferenceNode(node)) {
    return node.typeName;
  }
  if (ts.isTypeQueryNode(node)) {
    return node.exprName;
  }
  return undefined;
};

/** True for `import("…/ioc-registry.types.js")` / `typeof import(…)` type nodes. */
const isGeneratedImportTypeNode = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
  generatedDir: string,
): boolean =>
  ts.isImportTypeNode(node) &&
  ts.isLiteralTypeNode(node.argument) &&
  ts.isStringLiteral(node.argument.literal) &&
  moduleSpecifierTargetsGeneratedRegistry(
    node.argument.literal.text,
    path.resolve(sourceFile.fileName),
    generatedDir,
  );

/**
 * The declaration an entity name resolves to when it is a type alias or an interface, following one
 * import hop. Never resolves into the generated registry file — reading its declarations is the
 * thing being prevented. Declaration files are skipped too: a `.d.ts` cannot import the output of
 * the package being generated, and walking library types would be needlessly expensive.
 */
const namedTypeDeclarationFor = (
  checker: ts.TypeChecker,
  typeName: ts.EntityName,
): ts.TypeAliasDeclaration | ts.InterfaceDeclaration | undefined => {
  let symbol = checker.getSymbolAtLocation(typeName);
  if (symbol === undefined) {
    return undefined;
  }
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    const aliased = checker.getAliasedSymbol(symbol);
    if (aliased === undefined) {
      return undefined;
    }
    symbol = aliased;
  }
  const decl = symbol.declarations?.[0];
  if (
    decl === undefined ||
    !(ts.isTypeAliasDeclaration(decl) || ts.isInterfaceDeclaration(decl))
  ) {
    return undefined;
  }
  const declFile = decl.getSourceFile();
  if (declFile.isDeclarationFile || isGeneratedRegistrySourceFile(declFile)) {
    return undefined;
  }
  return decl;
};

/**
 * The first node in {@link typeNode}'s subtree that syntactically references the generated registry
 * file, following bare type-alias indirections into other source files, or `undefined` when nothing
 * does.
 *
 * The walk stops at an object-literal type reached THROUGH an alias hop. That boundary matches what
 * the emitter does: a named type is emitted by name and imported from its own module, so whatever
 * its members reference is never resolved here. Only an anonymous shape written inline at the
 * position under test (hop 0) is read into member-by-member, and that one is still walked.
 */
const findGeneratedReference = (
  typeNode: ts.TypeNode | undefined,
  checker: ts.TypeChecker,
  generatedDir: string,
): UnclaimedGeneratedReference | undefined => {
  if (typeNode === undefined) {
    return undefined;
  }

  const visitedAliases = new Set<ts.Node>();

  const walk = (
    node: ts.Node,
    sourceFile: ts.SourceFile,
    bindings: GeneratedBindingsOfFile,
    hops: number,
  ): UnclaimedGeneratedReference | undefined => {
    if (hops > 0 && ts.isTypeLiteralNode(node)) {
      return undefined;
    }
    if (isGeneratedImportTypeNode(node, sourceFile, generatedDir)) {
      return { node, sourceFile };
    }

    const entityName = referencedEntityName(node);
    if (entityName !== undefined) {
      if (resolveGeneratedBindingReference(entityName, bindings) !== undefined) {
        return { node, sourceFile };
      }
      // Not a generated binding here — but it may name a declaration that reaches one elsewhere.
      const decl =
        hops < MAX_ALIAS_HOPS
          ? namedTypeDeclarationFor(checker, entityName)
          : undefined;
      if (decl !== undefined && !visitedAliases.has(decl)) {
        visitedAliases.add(decl);
        const declFile = decl.getSourceFile();
        const declBindings = bindingsForFile(declFile, generatedDir);
        // An interface contributes only its heritage: its MEMBERS are emitted by name along with
        // the interface itself, exactly like a named object-literal alias, and are not read here.
        const targets: readonly ts.Node[] = ts.isTypeAliasDeclaration(decl)
          ? [decl.type]
          : (decl.heritageClauses ?? []);
        for (const target of targets) {
          const found = walk(target, declFile, declBindings, hops + 1);
          if (found !== undefined) {
            return found;
          }
        }
      }
    }

    let hit: UnclaimedGeneratedReference | undefined;
    ts.forEachChild(node, (child) => {
      if (hit === undefined) {
        hit = walk(child, sourceFile, bindings, hops);
      }
    });
    return hit;
  };

  const sourceFile = typeNode.getSourceFile();
  return walk(typeNode, sourceFile, bindingsForFile(sourceFile, generatedDir), 0);
};

export type GeneratedReferenceBackstopPaths = {
  readonly projectRoot: string;
  readonly generatedDir: string;
};

const formatUnclaimed = (
  found: UnclaimedGeneratedReference,
  projectRoot: string,
  context: string,
): string => {
  const rel = path
    .relative(projectRoot, path.resolve(found.sourceFile.fileName))
    .replace(/\\/g, "/");
  const { line } = found.sourceFile.getLineAndCharacterOfPosition(
    found.node.getStart(found.sourceFile),
  );
  return `${formatRejectedGeneratedReference(
    "unclaimedReferenceInDepsPosition",
    `${rel}:${line + 1}`,
    found.node.getText(found.sourceFile),
  )} (reached from ${context})`;
};

/**
 * Throws when a type node in a demand/supply position still reaches the generated registry file
 * after the claim parsers have had their turn. `context` names the position for the diagnostic
 * (`factory "buildUploadService" deps property "storage"`).
 *
 * Call this immediately before the type would otherwise be handed to the checker — that ordering
 * is the guarantee.
 */
export const assertGeneratedReferenceClaimed = (
  typeNode: ts.TypeNode | undefined,
  checker: ts.TypeChecker,
  paths: GeneratedReferenceBackstopPaths,
  context: string,
): void => {
  const found = findGeneratedReference(typeNode, checker, paths.generatedDir);
  if (found !== undefined) {
    throw new Error(formatUnclaimed(found, paths.projectRoot, context));
  }
};
