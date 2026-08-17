/**
 * @fileoverview Purely syntactic recognition of bindings to the generated registry-types file and
 * of every use of such a binding, classified against {@link GENERATED_REFERENCE_FORMS}.
 *
 * Nothing here consults the type checker or reads the generated file. That is the point: the
 * enumeration in `generatedReferenceForms.ts` only holds if the detector can recognize each form
 * off the source AST alone, which is what makes it cold-start-safe (the generated file need not
 * exist) and poisoning-proof (prior output is never read). Module-specifier matching is delegated
 * to `generatedRegistrySpecifier.ts` so there is exactly one place that decides what "the
 * generated file" means.
 */
import ts from "typescript";
import { moduleSpecifierTargetsGeneratedRegistry } from "./generatedRegistrySpecifier.js";

/** Name of the generated interface whose keys generation can resolve syntactically. */
export const IOC_GENERATED_CRADLE_NAME = "IocGeneratedCradle";

export type GeneratedBindingKind =
  | "named"
  | "namespace"
  | "default"
  | "importEquals";

/** A local name in a scanned file that is bound to the generated registry module. */
export type GeneratedRegistryBinding = {
  /** The local identifier introduced in the scanned file. */
  readonly localName: string;
  /** The name as exported by the generated file; `undefined` for namespace/default/require bindings. */
  readonly importedName: string | undefined;
  readonly kind: GeneratedBindingKind;
  /** The node to blame when the binding form itself is rejected. */
  readonly node: ts.Node;
};

export type GeneratedRegistryBindings = ReadonlyMap<
  string,
  GeneratedRegistryBinding
>;

const targetsGenerated = (
  specifier: ts.Expression | ts.LiteralExpression | undefined,
  containingAbsPath: string,
  generatedDir: string,
): boolean =>
  specifier !== undefined &&
  ts.isStringLiteral(specifier) &&
  moduleSpecifierTargetsGeneratedRegistry(
    specifier.text,
    containingAbsPath,
    generatedDir,
  );

const collectFromImportDeclaration = (
  stmt: ts.ImportDeclaration,
  out: Map<string, GeneratedRegistryBinding>,
): void => {
  const clause = stmt.importClause;
  if (clause === undefined) {
    return;
  }
  if (clause.name !== undefined) {
    out.set(clause.name.text, {
      localName: clause.name.text,
      importedName: undefined,
      kind: "default",
      // Blame the whole declaration: the import clause is what has to change, not the local name.
      node: stmt,
    });
  }
  const named = clause.namedBindings;
  if (named === undefined) {
    return;
  }
  if (ts.isNamespaceImport(named)) {
    out.set(named.name.text, {
      localName: named.name.text,
      importedName: undefined,
      kind: "namespace",
      node: named,
    });
    return;
  }
  for (const element of named.elements) {
    out.set(element.name.text, {
      localName: element.name.text,
      importedName: (element.propertyName ?? element.name).text,
      kind: "named",
      node: element,
    });
  }
};

/**
 * Every local name in {@link sourceFile} bound to the generated registry module, keyed by local
 * name. Only module-level import forms introduce such a binding; a name reaching the generated
 * file through an intermediate module is not a binding here (it is followed as a type-alias
 * indirection during resolution instead).
 */
export const collectGeneratedRegistryBindings = (
  sourceFile: ts.SourceFile,
  containingAbsPath: string,
  generatedDir: string,
): GeneratedRegistryBindings => {
  const out = new Map<string, GeneratedRegistryBinding>();

  for (const stmt of sourceFile.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      targetsGenerated(stmt.moduleSpecifier, containingAbsPath, generatedDir)
    ) {
      collectFromImportDeclaration(stmt, out);
      continue;
    }
    if (
      ts.isImportEqualsDeclaration(stmt) &&
      ts.isExternalModuleReference(stmt.moduleReference) &&
      targetsGenerated(
        stmt.moduleReference.expression,
        containingAbsPath,
        generatedDir,
      )
    ) {
      out.set(stmt.name.text, {
        localName: stmt.name.text,
        importedName: undefined,
        kind: "importEquals",
        node: stmt,
      });
    }
  }

  return out;
};

/** The leftmost identifier of an entity name (`A` in `A.B.C`). */
const leftmostIdentifier = (name: ts.EntityName): ts.Identifier =>
  ts.isIdentifier(name) ? name : leftmostIdentifier(name.left);

/** The leftmost identifier of a heritage-clause expression (`A` in `A.B`), when it has one. */
const leftmostExpressionIdentifier = (
  expr: ts.Expression,
): ts.Identifier | undefined => {
  if (ts.isIdentifier(expr)) {
    return expr;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return leftmostExpressionIdentifier(expr.expression);
  }
  return undefined;
};

/** A resolved reference to a generated binding at an entity-name occurrence. */
export type GeneratedBindingReference = {
  readonly binding: GeneratedRegistryBinding;
  /**
   * The generated export being named: the binding's imported name for a direct reference, or the
   * right-hand segment for a namespace-qualified one (`Ioc.Channels` → `Channels`). `undefined`
   * when the form names no single export (a bare namespace or default binding).
   */
  readonly referencedName: string | undefined;
  /** True when the entity name reaches past a single qualification (`Ioc.A.B`). */
  readonly overQualified: boolean;
};

/**
 * Resolves an entity name in a type position against the file's generated bindings, or `undefined`
 * when the name has nothing to do with the generated registry file.
 *
 * Local shadowing (a block-scoped type named the same as an import) is not modelled — the binding
 * table is keyed by name only. A shadowing declaration would at worst produce a false rejection
 * naming the exact line, never a silent fall-through, which is the safe direction.
 */
export const resolveGeneratedBindingReference = (
  name: ts.EntityName,
  bindings: GeneratedRegistryBindings,
): GeneratedBindingReference | undefined => {
  const leftmost = leftmostIdentifier(name);
  const binding = bindings.get(leftmost.text);
  if (binding === undefined) {
    return undefined;
  }
  if (ts.isIdentifier(name)) {
    return {
      binding,
      referencedName: binding.importedName,
      overQualified: false,
    };
  }
  return {
    binding,
    referencedName: name.right.text,
    overQualified: !ts.isIdentifier(name.left),
  };
};

/** A use of a generated binding in a type position, classified against the enumeration. */
export type GeneratedBindingUse = {
  readonly reference: GeneratedBindingReference;
  /** The node whose text is quoted in a diagnostic — the whole offending or claimed form. */
  readonly node: ts.Node;
  /** Id of the matching entry in {@link GENERATED_REFERENCE_FORMS}. */
  readonly formId: string;
};

const isSingleStringLiteralIndex = (indexType: ts.TypeNode): boolean =>
  ts.isLiteralTypeNode(indexType) && ts.isStringLiteral(indexType.literal);

/**
 * Classifies a type reference to a generated binding by the shape it sits in. The claimed shapes
 * are exactly two — `IocGeneratedCradle["<literal>"]` and a bare name — and every other shape is
 * a form the resolver cannot follow syntactically.
 *
 * Ancestors are passed in rather than read off `node.parent`: this runs before the program is
 * bound (parent pointers are set by the binder), which is deliberate — the whole point is to
 * classify without asking the checker for anything.
 */
const classifyTypeReferenceUse = (
  node: ts.TypeReferenceNode,
  reference: GeneratedBindingReference,
  parent: ts.Node | undefined,
  grandparent: ts.Node | undefined,
): GeneratedBindingUse => {
  const use = (formId: string, blame: ts.Node = node): GeneratedBindingUse => ({
    reference,
    node: blame,
    formId,
  });

  if (reference.overQualified) {
    return use("unsupportedIndexedAccessTarget");
  }

  if (
    parent !== undefined &&
    ts.isIndexedAccessTypeNode(parent) &&
    parent.objectType === node
  ) {
    if (node.typeArguments !== undefined && node.typeArguments.length > 0) {
      return use("genericObjectTypeIndexedAccess", parent);
    }
    if (reference.referencedName !== IOC_GENERATED_CRADLE_NAME) {
      return use("unsupportedIndexedAccessTarget", parent);
    }
    if (!isSingleStringLiteralIndex(parent.indexType)) {
      return use("nonLiteralIndexedAccess", parent);
    }
    if (
      grandparent !== undefined &&
      ts.isIndexedAccessTypeNode(grandparent) &&
      grandparent.objectType === parent
    ) {
      return use("chainedIndexedAccess", grandparent);
    }
    return use("cradleIndexedAccess", parent);
  }

  if (
    parent !== undefined &&
    ts.isTypeOperatorNode(parent) &&
    parent.operator === ts.SyntaxKind.KeyOfKeyword
  ) {
    return use("keyofGeneratedBinding", parent);
  }

  return use("bareTypeReference");
};

/**
 * Every use of a generated binding in {@link sourceFile}, classified. Callers decide what to do
 * with each classification: the codegen validator rejects the unsupported ones, the resolver
 * consumes the claimed ones.
 */
export const collectGeneratedBindingUses = (
  sourceFile: ts.SourceFile,
  bindings: GeneratedRegistryBindings,
): GeneratedBindingUse[] => {
  const uses: GeneratedBindingUse[] = [];
  if (bindings.size === 0) {
    return uses;
  }

  const ancestors: ts.Node[] = [];
  const ancestorAt = (depth: number): ts.Node | undefined =>
    ancestors[ancestors.length - depth];

  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node)) {
      const reference = resolveGeneratedBindingReference(
        node.typeName,
        bindings,
      );
      if (reference !== undefined) {
        uses.push(
          classifyTypeReferenceUse(
            node,
            reference,
            ancestorAt(1),
            ancestorAt(2),
          ),
        );
      }
    } else if (ts.isTypeQueryNode(node)) {
      const reference = resolveGeneratedBindingReference(
        node.exprName,
        bindings,
      );
      if (reference !== undefined) {
        uses.push({ reference, node, formId: "typeofGeneratedBinding" });
      }
    } else if (ts.isExpressionWithTypeArguments(node)) {
      // Heritage clause (`interface D extends Cradle`, `class C implements Cradle`): the target is
      // an expression, not a type node, so it never reaches the branches above.
      const root = leftmostExpressionIdentifier(node.expression);
      const reference =
        root !== undefined
          ? resolveGeneratedBindingReference(root, bindings)
          : undefined;
      if (reference !== undefined) {
        uses.push({
          reference,
          node: ancestorAt(1) ?? node,
          formId: "heritageClauseReference",
        });
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !ts.isExternalModuleReference(node.moduleReference)
    ) {
      const reference = resolveGeneratedBindingReference(
        node.moduleReference,
        bindings,
      );
      if (reference !== undefined) {
        uses.push({ reference, node, formId: "importEqualsEntityAlias" });
      }
    } else if (
      ts.isExportAssignment(node) &&
      node.isExportEquals === true &&
      ts.isIdentifier(node.expression)
    ) {
      const reference = resolveGeneratedBindingReference(
        node.expression,
        bindings,
      );
      if (reference !== undefined) {
        uses.push({
          reference,
          node,
          formId: "exportEqualsGeneratedBinding",
        });
      }
    }

    ancestors.push(node);
    ts.forEachChild(node, visit);
    ancestors.pop();
  };

  visit(sourceFile);
  return uses;
};
