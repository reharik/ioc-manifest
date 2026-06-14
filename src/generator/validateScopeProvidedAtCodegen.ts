import type { DemandSupplyAnalysisResult } from "./analyzeDemandSupply/index.js";

/**
 * Generation-time checks for `scopeProvided` against classified demand/supply entries.
 */
export const validateScopeProvidedAtCodegen = (
  declaredScopeProvided: readonly string[],
  demandSupply: DemandSupplyAnalysisResult,
): void => {
  if (declaredScopeProvided.length === 0) {
    return;
  }

  const entryByKey = new Map(demandSupply.entries.map((e) => [e.key, e]));
  for (const key of declaredScopeProvided) {
    const entry = entryByKey.get(key);
    if (entry === undefined) {
      console.warn(
        `[ioc-config] scopeProvided declares "${key}" but no factory demands it — declaration has no effect (check for a typo).`,
      );
    } else if (entry.classification === "local") {
      throw new Error(
        `[ioc-config] scopeProvided declares "${key}", but it is built by a local supplier. A key cannot be both manifest-built and scope-provided; remove it from scopeProvided or stop building it.`,
      );
    }
  }
};
