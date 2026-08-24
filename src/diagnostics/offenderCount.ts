/**
 * @fileoverview How many offenders a thrown generation error carried.
 *
 * Every aggregated generation error already states its count in its own preamble — "2 deps
 * properties do not name…", "3 grouped members declare a lifetime". That is the right place for a
 * READER to learn it and the wrong place for a program to: re-reading it means parsing prose.
 *
 * So the count rides along on the Error as a symbol-keyed property. A symbol rather than a named
 * field because the message is the public surface of a thrown error and this is not part of it: it
 * never serializes, never appears in `JSON.stringify`, and cannot collide with anything a consumer
 * puts on an error of their own. The only consumer is the staleness marker, which records how big
 * the failing attempt was so a later `ioc validate` can say so in its banner.
 *
 * A run that throws without a count is one error, which is the honest default: some failures
 * genuinely are a single problem.
 */

const OFFENDER_COUNT = Symbol.for("ioc-manifest.offenderCount");

/** Stamps an aggregated error with the number of offenders it reports. Returns the same error. */
export const withOffenderCount = <TError extends Error>(
  error: TError,
  count: number,
): TError => {
  Object.defineProperty(error, OFFENDER_COUNT, {
    value: count,
    enumerable: false,
    configurable: true,
  });
  return error;
};

/** The stamped count, or 1 for anything that carries none. */
export const offenderCountOf = (error: unknown): number => {
  if (typeof error !== "object" || error === null) {
    return 1;
  }
  const value = (error as Record<symbol, unknown>)[OFFENDER_COUNT];
  return typeof value === "number" && value > 0 ? value : 1;
};
