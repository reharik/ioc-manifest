/**
 * @fileoverview Equivalence of canonical group base-type identifiers, including app-level alias sets.
 */

/**
 * True when two canonical base-type identifiers should be treated as the same type for a group merge.
 * Uses only the alias set for the given group name (§14.4.1 — sets are independent per group).
 */
export const areCanonicalBaseTypeIdsEquivalent = (
  idA: string,
  idB: string,
  groupName: string,
  aliasSets: Readonly<Record<string, readonly string[]>> | undefined,
): boolean => {
  if (idA === idB) {
    return true;
  }

  const set = aliasSets?.[groupName];
  if (set === undefined) {
    return false;
  }

  return set.includes(idA) && set.includes(idB);
};
