/**
 * Picks a small set of candidate keys that may help spot typos: same first segment, then closest by sort order.
 */
export const pickSimilarKeys = (
  target: string,
  candidates: readonly string[],
  limit: number,
): string[] => {
  if (candidates.length === 0 || limit <= 0) {
    return [];
  }

  const uniq = [...new Set(candidates)].sort((a, b) => a.localeCompare(b));
  const head = target.includes(".")
    ? target.slice(0, target.indexOf("."))
    : target;
  const samePrefix = uniq.filter(
    (k) => k === target || k === head || k.startsWith(`${head}.`),
  );
  if (samePrefix.length >= limit) {
    return samePrefix.slice(0, limit);
  }
  const rest = uniq.filter((k) => !samePrefix.includes(k));
  return [...samePrefix, ...rest].slice(0, limit);
};
