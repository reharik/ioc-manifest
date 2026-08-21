/**
 * @fileoverview The one place a variant's DECLARED late-bound-value set meets the type checker.
 *
 * Two callers need it — stage 2's verification (which keys are scope-demands) and stage 3's opener
 * emission (which members the opener's parameter carries) — and both used to reach for the raw type
 * node themselves. They read it through here instead, for one reason: the lbv may be declared by
 * omission. `ScopeRoot<IRouter>` and `ScopeRoot<IRouter, Record<string, never>>` are the same
 * declaration, and the first has no type node to resolve. Absorbing that here is what keeps it out
 * of everything downstream: verification, the externals-exclusion union, the manifest's `lbvKeys`
 * and every diagnostic see an ordinary set of declared members, empty or not, and no consumer
 * branches on which spelling produced it.
 *
 * The raw node on the record is never replaced. As in stage 2, the checker is applied at this
 * boundary and the resolved types stay local to the caller.
 */
import ts from "typescript";
import type { DiscoveredScopeRoot } from "./types.js";

/** One declared late-bound value: the key as written, and its resolved type. */
export type DeclaredLbvMember = {
  readonly key: string;
  readonly type: ts.Type;
};

export type DeclaredLbv = {
  /**
   * The file the lbv type argument was written in — the context an emitted member type is imported
   * relative to. `undefined` for a declaration by omission, which has no written site and, being
   * empty, needs none.
   */
  readonly declarationSourceFile: ts.SourceFile | undefined;
  /** The declared members, sorted by key. Empty is an ordinary answer, not a special case. */
  readonly members: readonly DeclaredLbvMember[];
};

const EMPTY_DECLARED_LBV: DeclaredLbv = {
  declarationSourceFile: undefined,
  members: [],
};

/**
 * The declared lbv of ONE variant, resolved.
 *
 * Per variant, deliberately — the same discipline verification and emission keep everywhere else:
 * nothing here can see, combine, or fall back to another variant's declaration.
 */
export const readDeclaredLbv = (
  checker: ts.TypeChecker,
  variant: DiscoveredScopeRoot,
): DeclaredLbv => {
  const lbvTypeNode = variant.lbvTypeNode;
  if (lbvTypeNode === undefined) {
    return EMPTY_DECLARED_LBV;
  }

  const lbvType = checker.getApparentType(
    checker.getTypeFromTypeNode(lbvTypeNode),
  );

  const members = checker
    .getPropertiesOfType(lbvType)
    .map((prop) => prop.getName())
    .filter((name) => !name.startsWith("__"))
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({
      key,
      type: checker.getTypeOfSymbol(checker.getPropertyOfType(lbvType, key)!),
    }));

  return { declarationSourceFile: lbvTypeNode.getSourceFile(), members };
};

/** The declared keys alone, for callers that never need the member types. */
export const declaredLbvKeys = (
  checker: ts.TypeChecker,
  variant: DiscoveredScopeRoot,
): string[] => readDeclaredLbv(checker, variant).members.map((m) => m.key);
