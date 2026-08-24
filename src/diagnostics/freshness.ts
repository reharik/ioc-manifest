/**
 * @fileoverview The quiet half of the two-worlds family: artifacts that PREDATE their sources.
 *
 * ### The failure this exists for
 *
 * `generationState.ts` covers the loud half — a generation that FAILED wrote nothing, so the
 * artifacts are provably behind and every artifact-reading verb banners them. The half it does not
 * cover is the one the field kept reporting, three times in a week:
 *
 * > Edit a library's source. Forget the regenerate/rebuild ordering. Run `ioc validate` in the app.
 * > Read a confidently-worded finding that describes the world as it was before the edit.
 *
 * Nothing failed. Nothing is missing. The library's artifacts are a perfectly good description of
 * a moment that has passed, the app composed them, and the resulting finding is wrong in a way that
 * carries no cue at all — no banner, no caveat, nothing to distinguish it from a real one. The
 * developer's most recent instance: a contract un-grouped in `media-core`'s source, and the api's
 * validate went on reporting the grouped-world externals error until `media-core` regenerated.
 *
 * ### What is checked, and what a match means
 *
 * Each generation records the fingerprint of its inputs (see
 * {@link import("./generationState.js").hashGenerationInputs}). Here that fingerprint is recomputed
 * from the package's sources AS THEY ARE NOW and compared. A mismatch means at least one scanned
 * file's bytes, or the config's, differ from what generation saw.
 *
 * A MATCH is the weaker claim, and the wording never overstates it. The fingerprint covers the
 * scanned file set and the config; a type imported from outside `scanDirs` can change generation's
 * output without moving it. So a match says "the scanned sources and the config are byte-identical
 * to what generation saw", and a mismatch says the artifacts *may* predate the sources — never
 * that they provably do, and never that a matching hash proves them current.
 *
 * ### Warn loud, never abort
 *
 * `ioc validate` exists to check COMMITTED artifacts. Refusing to report on out-of-date ones would
 * take away the verb's whole job at exactly the moment somebody needs it, and this signal is a
 * heuristic besides. So: nothing here changes an exit code. What it does instead is be impossible
 * to miss — a banner at the top of the output, AND an inline caveat on every individual finding
 * that resolves through a package flagged here, because the reader who most needs the warning is
 * the one who skimmed past the banner to get to the errors.
 *
 * Absence of a record is calibrated differently again. Artifacts generated before records were
 * written, or a package that has never generated, produce ONE quiet advisory line — absence of
 * evidence is not evidence of staleness, and it must not read like it is.
 */
import { LOCAL_PACKAGE_IDENTIFIER } from "../config/packageIdentifier.js";
import { localPackageProse, LOCAL_PACKAGE_ROLE } from "./localPackageLabel.js";
import {
  type IocGenerationOutcome,
  type IocGenerationRecord,
  relativeAge,
} from "./generationState.js";

/**
 * Why a package could not be judged, when it could not be.
 *
 * Two different absences, kept apart because the remedies differ: `no-record` is fixed by
 * generating that package once, `unreadable-sources` usually means a published package that ships
 * its manifest but not the sources it was generated from, where there is nothing to fix.
 */
export type FreshnessUnknownReason = "no-record" | "unreadable-sources";

export type PackageFreshness = {
  /** How the package is named in prose: its npm name, or `this app` for the running package. */
  readonly name: string;
  /** The machine token — a `composedManifests` entry, or `"local"`. */
  readonly sourceId: string;
  /** Absent when the package has no generation record at all. */
  readonly outcome?: IocGenerationOutcome;
  /** ISO-8601, from the record. Absent when there is no record. */
  readonly generatedAt?: string;
  /**
   * Whether the sources as they are now fingerprint to what generation saw.
   *
   * Absent — not `false` — when the comparison could not be made. `false` is a finding; absence is
   * the admission that there is nothing to report, and collapsing the two would turn every
   * unreadable package into a staleness warning.
   */
  readonly currentMatches?: boolean;
  /** Set only alongside an absent {@link currentMatches}. */
  readonly unknownReason?: FreshnessUnknownReason;
};

/** The package's artifacts may predate its sources — the loud case. */
export const isStale = (freshness: PackageFreshness): boolean =>
  freshness.currentMatches === false;

/** Nothing could be concluded — the quiet case. */
export const isUnknown = (freshness: PackageFreshness): boolean =>
  freshness.currentMatches === undefined;

export const isLocalFreshness = (freshness: PackageFreshness): boolean =>
  freshness.sourceId === LOCAL_PACKAGE_IDENTIFIER;

/**
 * The subject of every sentence about a package, in the possessive-friendly form.
 *
 * The local package is `this app` and NOT `@apps/api (this app)`: the parenthetical role is there
 * to disambiguate a name in a list of packages, and it cannot take a possessive without reading
 * like a typo. "this app" needs no disambiguation — the reader is standing in it.
 */
const subjectOf = (freshness: PackageFreshness): string =>
  isLocalFreshness(freshness) ? LOCAL_PACKAGE_ROLE : freshness.name;

/**
 * Builds the freshness verdict for one package from its record and the hash of its sources now.
 *
 * `currentHash` is `undefined` when the package's own config or scan set could not be resolved —
 * the published-without-sources case — and that is reported as unknown rather than as a mismatch.
 */
export const judgeFreshness = (input: {
  readonly name: string;
  readonly sourceId: string;
  readonly record: IocGenerationRecord | undefined;
  readonly currentHash: string | undefined;
}): PackageFreshness => {
  const { name, sourceId, record, currentHash } = input;
  if (record === undefined) {
    return { name, sourceId, unknownReason: "no-record" };
  }

  const base = {
    name,
    sourceId,
    outcome: record.outcome,
    generatedAt: record.at,
  } as const;

  // A record written before its inputs were resolved carries no hash, and a package whose sources
  // cannot be re-read gives nothing to compare it against. Both are unknown, not stale.
  if (record.inputsHash === undefined || currentHash === undefined) {
    return { ...base, unknownReason: "unreadable-sources" };
  }

  return { ...base, currentMatches: record.inputsHash === currentHash };
};

/**
 * The banner, one per stale package.
 *
 * Three moves in one sentence and a half: whose artifacts, that they MAY predate the sources (never
 * that they do — see the file overview), and the consequence for the report underneath. The last
 * clause is the one that matters: a reader who knows only that something is stale still has to
 * guess which of the findings below to distrust.
 */
export const formatFreshnessBanner = (
  freshness: PackageFreshness,
  now?: number,
): string => {
  const subject = subjectOf(freshness);
  const where = isLocalFreshness(freshness) ? "here" : "there";
  const age =
    freshness.generatedAt === undefined
      ? "at an unknown time"
      : relativeAge(freshness.generatedAt, now);
  return (
    `⚠ ${subject}'s generated artifacts may predate its sources ` +
    `(generated ${age}; sources have changed since). ` +
    `Findings involving its keys may describe the old world — regenerate ${where} first.`
  );
};

/**
 * The ordering hint, printed once when BOTH a composed package and the running package are stale.
 *
 * Regenerating the app first would compose the library's OLD manifest and produce a fresh-looking
 * app artifact built on stale input — a worse state than the one the developer started in, because
 * now nothing is flagged. Dependency order is the only order that converges.
 */
export const formatFreshnessOrderingHint = (
  staleComposedNames: readonly string[],
): string =>
  `  Regenerate ${staleComposedNames.join(", ")} before this app: this app's generation composes ` +
  `${staleComposedNames.length === 1 ? "it" : "them"}, so regenerating here first would just bake the old output in.`;

/**
 * The quiet advisory, one line, for a package nothing could be concluded about.
 *
 * Deliberately not a warning. Nothing is known to be wrong; what is missing is the evidence that
 * would let anything be said either way, and a line that sounded like the banner above would spend
 * the reader's alarm on a non-event.
 */
export const formatFreshnessAdvisory = (
  freshness: PackageFreshness,
): string => {
  const subject = subjectOf(freshness);
  return freshness.unknownReason === "no-record"
    ? `note: no generation record for ${subject} — whether its artifacts predate its sources is unknown until it next generates.`
    : `note: ${subject}'s sources could not be re-read — whether its artifacts predate them is unknown.`;
};

/**
 * The inline caveat carried by a finding that resolves through a stale package.
 *
 * One line, attached to the issue itself, because the banner is at the top of the output and the
 * reader who needs this most is the one who scrolled past it to the first error.
 */
export const formatFreshnessCaveat = (
  staleNames: readonly string[],
): string =>
  `note: ${staleNames.join(", ")} may be stale; this finding may describe the old world`;

/**
 * How a stale package is named INSIDE a finding's caveat.
 *
 * The full prose form, unlike the banner's subject: a caveat sits in a wall of other findings with
 * no banner in sight, so `this app` on its own would be the same ambiguity `localPackageProse`
 * exists to remove.
 */
export const caveatNameFor = (freshness: PackageFreshness): string =>
  isLocalFreshness(freshness)
    ? localPackageProse(freshness.name)
    : freshness.name;

/** The `freshness` array `--json` carries, one entry per package, in slice order. */
export const toFreshnessJson = (
  entries: readonly PackageFreshness[],
): readonly Record<string, unknown>[] =>
  entries.map((entry) => ({
    name: entry.name,
    ...(entry.outcome !== undefined ? { outcome: entry.outcome } : {}),
    ...(entry.generatedAt !== undefined
      ? { generatedAt: entry.generatedAt }
      : {}),
    ...(entry.currentMatches !== undefined
      ? { currentMatches: entry.currentMatches }
      : {}),
  }));
