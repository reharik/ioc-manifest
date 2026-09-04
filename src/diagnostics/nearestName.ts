/**
 * @fileoverview Nearest-match suggestion for a name the user typed that nothing answers to.
 *
 * One implementation, because a "did you mean" that disagrees with itself between two error paths
 * is worse than none: `registrations` names are adjudicated in two places — `ioc.config` semantics
 * during planning, and the composition suite both verbs run — and a reader who fixes a contract
 * name on generation's advice should get the same advice from validate.
 *
 * Case-insensitive exact first, so a name that differs only in case is always the answer. Then
 * edit distance, capped at 2: past that the "suggestion" is a guess, and a wrong one sends a reader
 * to rename something that was never the problem.
 */

/** Levenshtein distance, two rows. */
const distance = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i, ...Array.from({ length: b.length }, () => 0)];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = row;
  }
  return prev[b.length]!;
};

export const NEAREST_NAME_MAX_DISTANCE = 2;

export const nearestName = (
  unknown: string,
  candidates: Iterable<string>,
): string | undefined => {
  const all = [...candidates];
  const lower = unknown.toLowerCase();
  const exact = all.find((c) => c.toLowerCase() === lower);
  if (exact !== undefined) {
    return exact;
  }

  let best: string | undefined;
  let bestDistance = NEAREST_NAME_MAX_DISTANCE + 1;
  for (const candidate of all) {
    const d = distance(unknown, candidate);
    if (d > 0 && d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return bestDistance <= NEAREST_NAME_MAX_DISTANCE ? best : undefined;
};
