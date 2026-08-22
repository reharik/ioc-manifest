/**
 * @fileoverview Resolving a configured group's BASE TYPE — the one place that answers "which
 * declared type is `groups.<name>.baseType`?".
 *
 * Two passes need the answer and must never disagree about it: the authoritative membership pass
 * in `resolveGroupPlan`, which runs after the registration plan, and the grouped-contract index in
 * `groupedContracts.ts`, which has to run BEFORE it (grouped contracts are categorically slotless,
 * so the plan's own election depends on knowing who is grouped). Both call through here.
 *
 * The resolution itself is two-step by necessity: `resolveDeclaredBaseType` scans program sources
 * for a top-level declaration of the name, and when that is ambiguous or absent the canonical
 * base-type id's declaration file is used to pin the one that counts.
 */
import type * as ts from "typescript";
import { resolveDeclaredBaseType, type BaseTypeResolution } from "./baseTypeAssignability.js";
import {
  resolveBaseTypeFromDeclarationFile,
  resolveCanonicalBaseTypeId,
  type CanonicalBaseTypeIdResolution,
} from "./canonicalBaseTypeId.js";
import type { GroupDiscoveryBuildContext } from "./resolveGroupPlan.js";

export type ResolvedGroupBaseType =
  | {
      ok: true;
      canonical: Extract<CanonicalBaseTypeIdResolution, { ok: true }>;
      type: ts.Type;
    }
  | { ok: false; message: string };

/**
 * The declared type behind `groups.<name>.baseType`, with its canonical id.
 *
 * Returns the failure message rather than throwing: the authoritative pass turns it into a
 * `group_unknown_base_type` issue, while the early index simply contributes no members for a group
 * it cannot resolve — a config error is `buildGroupPlan`'s to raise, once.
 */
export const resolveGroupBaseType = (
  checker: ts.TypeChecker,
  discovery: GroupDiscoveryBuildContext,
  baseTypeName: string,
): ResolvedGroupBaseType => {
  const canonical = resolveCanonicalBaseTypeId(checker, discovery, baseTypeName);
  if (!canonical.ok) {
    return { ok: false, message: canonical.message };
  }

  const declaredBase: BaseTypeResolution = resolveDeclaredBaseType(
    discovery.program,
    checker,
    baseTypeName,
  );
  const resolvedBase = declaredBase.ok
    ? declaredBase
    : resolveBaseTypeFromDeclarationFile(
        discovery.program,
        checker,
        canonical.declarationFile,
        baseTypeName,
      );

  if (!resolvedBase.ok) {
    return { ok: false, message: resolvedBase.message };
  }

  return { ok: true, canonical, type: resolvedBase.type };
};
