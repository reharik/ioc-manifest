/**
 * @fileoverview The staleness marker — which of the two worlds a reader is standing in.
 *
 * ### The two worlds
 *
 * `ioc generate` describes LIVE SOURCE. It reads the files as they are now, and when it finds a
 * hard error it refuses to write anything (atomic-or-nothing), so the artifacts on disk stay
 * exactly as the last successful run left them.
 *
 * `ioc validate`, `ioc inspect` and `ioc explain` describe THOSE ARTIFACTS — the last successful
 * write. That is the right thing for them to describe: they exist to answer questions about what
 * was emitted and what it composes with.
 *
 * Both are telling the truth, about different moments. Nothing labelled which moment, so a
 * developer could watch generation refuse a demand for a grouped member and, in the next command,
 * watch validate describe a container in which that demand is an ordinary unsatisfied external —
 * two true stories, no cue that they are separated in time, and no way to tell which one to act on.
 *
 * This module is the cue. EVERY generation — succeeding or failing — leaves a record; every
 * artifact-reading surface checks for it and qualifies its output from what it finds.
 *
 * ### Two halves of the same family
 *
 * A failed generation is the loud half: the artifacts are provably not what the sources say,
 * because the run that would have updated them refused to write. `outcome: "failed"` drives the
 * staleness banner, exactly as it always has.
 *
 * A SUCCEEDED generation is the quiet half, and the one the field kept hitting: the run wrote
 * artifacts that were correct at the time, and then somebody edited the sources and did not
 * regenerate. Nothing failed, nothing is missing, and every verb downstream reports the old world
 * with total confidence. `outcome: "success"` plus {@link IocGenerationRecord.inputsHash} is what
 * lets a reader be told the artifacts MAY PREDATE the sources beside them — see
 * `diagnostics/freshness.ts`, which does the comparing.
 *
 * ### What the record is not
 *
 * It is not a diff. `inputsHash` fingerprints the resolved inputs — the config source text and the
 * content of every scanned file — and its only job is match or mismatch. It cannot say what
 * changed and does not try.
 *
 * Its coverage stops at the scan set. A type imported from OUTSIDE the configured `scanDirs` — a
 * sibling package's `.d.ts`, a type from `node_modules` — can change without moving this hash, and
 * generation's output can depend on such a type. So a match means "the scanned sources and the
 * config are byte-identical to what generation saw", never "the artifacts are provably current",
 * and every message built on it says *may*.
 *
 * It is also not authoritative about the CURRENT state of the tree. It records what a generation
 * attempt did at a moment; whether it would do the same now is answered by running generation.
 * Every message this module produces is phrased in the past tense for that reason.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/** File name of the marker. Dot-prefixed: it is tooling state, not a source or generated artifact. */
export const IOC_GENERATION_STATE_FILENAME = ".ioc-generation-state.json";

/**
 * Where the marker lives: BESIDE the generated directory, never inside it.
 *
 * Inside would put it in the set every consumer diffs to prove generation is deterministic, and a
 * file carrying a timestamp can never survive that. Beside keeps `git diff -- src/generated` clean
 * and keeps the marker somewhere a reader will actually notice it.
 */
export const generationStatePathFor = (generatedDir: string): string =>
  path.join(path.dirname(generatedDir), IOC_GENERATION_STATE_FILENAME);

/** Project-relative, forward slashes, so a hash taken on Windows equals one taken on Linux. */
const toPosixRelative = (projectRoot: string, file: string): string =>
  path.relative(projectRoot, file).split(path.sep).join("/");

export type IocGenerationOutcome = "success" | "failed";

/**
 * What one generation attempt left behind, whichever way it went.
 *
 * Written on EVERY outcome. A success record is not bookkeeping for its own sake: it is the only
 * thing that can later be compared against the sources to say the artifacts may have fallen behind
 * them. Before it existed a successful run left no evidence at all, so "generated correctly, then
 * the sources moved" was indistinguishable from "generated a moment ago".
 */
export type IocGenerationRecord = {
  /** Explicit rather than implied by which fields are present, so the JSON reads on its own. */
  readonly outcome: IocGenerationOutcome;
  /** ISO-8601, UTC. When the attempt finished. */
  readonly at: string;
  /** How many offenders a FAILED attempt reported. Absent on success, where it would mean nothing. */
  readonly errorCount?: number;
  /**
   * Fingerprint of the resolved inputs, `sha256:<hex>`.
   *
   * Omitted when the run ended before its inputs were resolved — there is nothing to fingerprint
   * then, and a placeholder would be a claim. See the file overview for what this is and is not.
   */
  readonly inputsHash?: string;
};

/**
 * The FAILED record, narrowed.
 *
 * The staleness banner — the loud half, unchanged since it shipped — reads only this variant, and
 * now says so in the type rather than by convention. `errorCount` is required here because a
 * failure always has one; a record on disk that omits it reads back as `1`.
 */
export type IocGenerationStateMarker = IocGenerationRecord & {
  readonly outcome: "failed";
  readonly errorCount: number;
};

/**
 * The content fingerprint of one file, so the top-level hash is over hashes, not over megabytes of
 * concatenated source.
 */
const sha256Of = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

/**
 * Fingerprints the inputs a generation run resolved: the config source, and the CONTENT of every
 * scanned file.
 *
 * Content, not existence. A file LIST answers "were different files scanned" and nothing else, and
 * the failure the field kept hitting lives entirely inside a stable file list: somebody edits one
 * line of one existing file — un-grouping a contract, moving a lifetime — and every
 * artifact-reading verb goes on describing the previous world. A list-shaped hash matches straight
 * through that. A content-shaped one does not.
 *
 * The config SOURCE rather than the loaded object: the object is a live module export that may hold
 * functions, and reading the text is both cheaper and closer to what a developer changed. Paths are
 * sorted and made project-relative so the hash does not move with the checkout directory, and each
 * file contributes `relativePath:sha256(content)` so a rename and an edit are equally visible.
 *
 * Bounded by the scan set, deliberately — see the file overview. Types reached from outside
 * `scanDirs` are not covered, which is why every message built on this says *may*.
 */
export const hashGenerationInputs = (
  projectRoot: string,
  configPath: string | undefined,
  discoveryFiles: readonly string[],
): string => {
  const hash = createHash("sha256");

  if (configPath !== undefined) {
    try {
      hash.update(fs.readFileSync(configPath, "utf8"));
    } catch {
      // An unreadable config is itself a state worth fingerprinting differently from a readable
      // one, and the record is diagnostic rather than load-bearing — so a sentinel, not a throw.
      hash.update("<config-unreadable>");
    }
  }
  hash.update(" files ");

  const entries = discoveryFiles
    .map((file) => ({
      rel: toPosixRelative(projectRoot, file),
      file,
    }))
    .sort((a, b) => a.rel.localeCompare(b.rel));

  for (const { rel, file } of entries) {
    let contentHash: string;
    try {
      contentHash = sha256Of(fs.readFileSync(file, "utf8"));
    } catch {
      // A file the scan listed but that cannot be read now is a change worth mismatching on.
      contentHash = "<unreadable>";
    }
    hash.update(rel);
    hash.update(":");
    hash.update(contentHash);
    hash.update(" ");
  }

  return `sha256:${hash.digest("hex")}`;
};

/**
 * Writes a generation record atomically.
 *
 * Best effort throughout, and never rethrows. On the failure path this runs while a generation
 * error is already propagating, and an unwritable record must never replace the real error with a
 * filesystem one. On the success path the artifacts have already landed, and failing the run over
 * bookkeeping would be worse than the missing banner it costs.
 *
 * Temp-then-rename because a reader can arrive mid-write, and half a JSON document reads as a
 * corrupt record — which the reader below treats as absent, silently losing the signal.
 */
export const writeGenerationRecord = async (
  markerPath: string,
  record: IocGenerationRecord,
): Promise<void> => {
  const tempPath = `${markerPath}.tmp-${process.pid}`;
  try {
    await fsp.mkdir(path.dirname(markerPath), { recursive: true });
    await fsp.writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await fsp.rename(tempPath, markerPath);
  } catch {
    try {
      await fsp.unlink(tempPath);
    } catch {
      // Best effort cleanup.
    }
  }
};

/**
 * Reads the record beside a generated directory, whatever outcome it holds.
 *
 * Synchronous and forgiving: every caller is a reporting surface that must still produce its report
 * when the record is missing, unreadable, or malformed. A record that does not parse is treated as
 * absent — a corrupted banner is worse than no banner, and a missing one downgrades to the quiet
 * advisory rather than to a claim.
 */
export const readGenerationRecord = (
  generatedDir: string,
): IocGenerationRecord | undefined => {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(generationStatePathFor(generatedDir), "utf8"),
    ) as Partial<IocGenerationRecord>;
    if (
      (parsed.outcome !== "failed" && parsed.outcome !== "success") ||
      typeof parsed.at !== "string"
    ) {
      return undefined;
    }
    return {
      outcome: parsed.outcome,
      at: parsed.at,
      ...(typeof parsed.errorCount === "number" && parsed.errorCount > 0
        ? { errorCount: parsed.errorCount }
        : {}),
      ...(typeof parsed.inputsHash === "string"
        ? { inputsHash: parsed.inputsHash }
        : {}),
    };
  } catch {
    return undefined;
  }
};

/**
 * The FAILED record only, or `undefined` when the last attempt succeeded.
 *
 * The staleness banner's reader, and deliberately narrower than {@link readGenerationRecord}: every
 * surface that calls this one asks "are the artifacts the output of a run that refused to write",
 * and a success record must answer no to that question as loudly as an absent one does. Widening it
 * would silently turn the staleness banner into a banner about every generation ever run.
 */
export const readGenerationState = (
  generatedDir: string,
): IocGenerationStateMarker | undefined => {
  const record = readGenerationRecord(generatedDir);
  if (record?.outcome !== "failed") {
    return undefined;
  }
  return {
    ...record,
    outcome: "failed",
    errorCount: record.errorCount ?? 1,
  };
};

/** "3 minutes ago" — coarse on purpose; the marker is a cue, not a clock. */
export const relativeAge = (iso: string, now: number = Date.now()): string => {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "at an unknown time";
  }
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  const [value, unit] =
    seconds < 60
      ? [seconds, "second"]
      : seconds < 3600
        ? [Math.floor(seconds / 60), "minute"]
        : seconds < 86_400
          ? [Math.floor(seconds / 3600), "hour"]
          : [Math.floor(seconds / 86_400), "day"];
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
};

/**
 * The banner every artifact-reading surface prints FIRST when a marker is present.
 *
 * Three sentences, in the order a reader needs them: the artifacts are stale, why (the last attempt
 * failed, how long ago and how big), and what the report below therefore describes. The last one is
 * the whole point — without it a reader has a warning but still no idea how to read what follows.
 */
export const formatStalenessBanner = (
  marker: IocGenerationStateMarker,
  now?: number,
): string => {
  const errors = `${marker.errorCount} error${marker.errorCount === 1 ? "" : "s"}`;
  return [
    "[stale] Generated artifacts are STALE: the last generation attempt failed and wrote nothing.",
    `        last attempt:  ${relativeAge(marker.at, now)} (${marker.at}), ${errors}`,
    "        Results below describe the LAST SUCCESSFUL generation, not the current sources.",
    "        Run `ioc generate` to see what the sources say now.",
  ].join("\n");
};

/**
 * The mirror line generation's own failure output ends with.
 *
 * Generation is the other half of the same confusion: a developer who has just been told the run
 * failed needs to know that the files on disk did NOT change, or they will go looking for a
 * half-written manifest.
 */
export const GENERATION_FAILURE_ARTIFACTS_NOTE =
  "[ioc] Nothing was written: the artifacts on disk remain from the last successful generation and were not modified. " +
  `A marker (${IOC_GENERATION_STATE_FILENAME}) records this failure so \`ioc validate\`, \`ioc inspect\` and \`ioc explain\` can say they are describing stale output.`;
