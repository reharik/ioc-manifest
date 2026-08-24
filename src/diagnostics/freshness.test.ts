/**
 * The freshness verdict's own contract — how a package is classified, and the three volumes it can
 * be reported at.
 *
 * The end-to-end side (a real library edited without regenerating, a real `ioc validate` bannering
 * it and caveating the finding it produced) lives in
 * `generator/generationFreshness.integration.test.ts`. What is pinned here is the classification
 * itself, and the wording every surface prints — including the calibration, which is the part most
 * likely to be eroded by a later edit: a mismatch is loud, an absence is quiet, and nothing ever
 * claims proof.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  caveatNameFor,
  formatFreshnessAdvisory,
  formatFreshnessBanner,
  formatFreshnessCaveat,
  formatFreshnessOrderingHint,
  isLocalFreshness,
  isStale,
  isUnknown,
  judgeFreshness,
  toFreshnessJson,
  type PackageFreshness,
} from "./freshness.js";

const LIB = "@packages/media-core";
const NOW = Date.parse("2026-08-23T12:00:00.000Z");

const judge = (
  recordHash: string | undefined,
  currentHash: string | undefined,
  overrides?: { name?: string; sourceId?: string },
): PackageFreshness =>
  judgeFreshness({
    name: overrides?.name ?? LIB,
    sourceId: overrides?.sourceId ?? LIB,
    record: {
      outcome: "success",
      at: "2026-08-23T11:00:00.000Z",
      ...(recordHash !== undefined ? { inputsHash: recordHash } : {}),
    },
    currentHash,
  });

describe("judgeFreshness", () => {
  describe("When the recorded fingerprint and the sources now agree", () => {
    it("should report a match, and nothing louder", () => {
      const verdict = judge("sha256:aaa", "sha256:aaa");

      assert.equal(verdict.currentMatches, true);
      assert.equal(isStale(verdict), false);
      assert.equal(isUnknown(verdict), false);
      assert.equal(verdict.outcome, "success");
      assert.equal(verdict.generatedAt, "2026-08-23T11:00:00.000Z");
    });
  });

  describe("When they disagree", () => {
    it("should report a mismatch — the one loud case", () => {
      const verdict = judge("sha256:aaa", "sha256:bbb");

      assert.equal(verdict.currentMatches, false);
      assert.equal(isStale(verdict), true);
    });
  });

  describe("When there is no record at all", () => {
    it("should report unknown rather than stale, and say which absence it is", () => {
      const verdict = judgeFreshness({
        name: LIB,
        sourceId: LIB,
        record: undefined,
        currentHash: "sha256:aaa",
      });

      // Artifacts predating records, or a package that never generated. Absence of evidence is not
      // evidence, and a `false` here would have turned every such package into a warning.
      assert.equal(verdict.currentMatches, undefined);
      assert.equal(isUnknown(verdict), true);
      assert.equal(isStale(verdict), false);
      assert.equal(verdict.unknownReason, "no-record");
      assert.equal(verdict.outcome, undefined);
    });
  });

  describe("When the sources cannot be re-read", () => {
    it("should report unknown — a published package without sources is not a stale one", () => {
      const verdict = judge("sha256:aaa", undefined);

      assert.equal(isUnknown(verdict), true);
      assert.equal(verdict.unknownReason, "unreadable-sources");
      // The record's own facts survive: the reader still learns when it was generated.
      assert.equal(verdict.generatedAt, "2026-08-23T11:00:00.000Z");
    });
  });

  describe("When the record predates fingerprinting", () => {
    it("should report unknown rather than compare against nothing", () => {
      assert.equal(judge(undefined, "sha256:aaa").unknownReason, "unreadable-sources");
    });
  });

  describe("When the record is a FAILED one", () => {
    it("should still be judged, carrying the failed outcome through", () => {
      const verdict = judgeFreshness({
        name: LIB,
        sourceId: LIB,
        record: {
          outcome: "failed",
          at: "2026-08-23T11:00:00.000Z",
          errorCount: 2,
          inputsHash: "sha256:aaa",
        },
        currentHash: "sha256:bbb",
      });

      // Both halves of the family can be true at once — the last attempt refused to write AND the
      // sources have moved since. The staleness banner says the first; this says the second.
      assert.equal(verdict.outcome, "failed");
      assert.equal(isStale(verdict), true);
    });
  });
});

describe("the banner", () => {
  const banner = formatFreshnessBanner(judge("sha256:aaa", "sha256:bbb"), NOW);

  describe("When a composed package's artifacts may predate its sources", () => {
    it("should name it, date it, and say what it means for the report below", () => {
      assert.equal(
        banner,
        "⚠ @packages/media-core's generated artifacts may predate its sources " +
          "(generated 1 hour ago; sources have changed since). " +
          "Findings involving its keys may describe the old world — regenerate there first.",
      );
    });

    it("should say MAY, never that the artifacts are proven stale", () => {
      // The fingerprint covers the scanned sources and the config, and nothing beyond them.
      assert.match(banner, /may predate/);
      assert.doesNotMatch(banner, /\bis stale\b|are stale|out of date\b/);
    });

    it("should carry no colour of its own, so NO_COLOR output is byte-stable", () => {
      // eslint-disable-next-line no-control-regex
      assert.doesNotMatch(banner, /\[/);
    });
  });

  describe("When it is THIS app whose artifacts may predate its sources", () => {
    it("should take the symmetric form and point the fix here", () => {
      const local = judge("sha256:aaa", "sha256:bbb", {
        name: "@apps/api",
        sourceId: "local",
      });

      assert.equal(isLocalFreshness(local), true);
      assert.equal(
        formatFreshnessBanner(local, NOW),
        "⚠ this app's generated artifacts may predate its sources " +
          "(generated 1 hour ago; sources have changed since). " +
          "Findings involving its keys may describe the old world — regenerate here first.",
      );
    });
  });
});

describe("the ordering hint", () => {
  describe("When a composed package and this app are BOTH behind", () => {
    it("should send the developer to the dependency first", () => {
      // Regenerating the app first composes the library's old manifest: same wrongness, now with
      // a fresh-looking artifact and no warning on it.
      assert.equal(
        formatFreshnessOrderingHint([LIB]),
        "  Regenerate @packages/media-core before this app: this app's generation composes it, " +
          "so regenerating here first would just bake the old output in.",
      );
    });

    it("should pluralize when more than one dependency is behind", () => {
      assert.match(
        formatFreshnessOrderingHint([LIB, "@packages/media-io"]),
        /composes them,/,
      );
    });
  });
});

describe("the quiet advisory", () => {
  describe("When nothing could be concluded", () => {
    it("should be one line, and audibly quieter than the banner", () => {
      const noRecord = formatFreshnessAdvisory(
        judgeFreshness({ name: LIB, sourceId: LIB, record: undefined, currentHash: undefined }),
      );

      assert.equal(
        noRecord,
        "note: no generation record for @packages/media-core — whether its artifacts predate its sources is unknown until it next generates.",
      );
      // The calibration itself: no warning glyph, no imperative, nothing that reads as an alarm.
      assert.doesNotMatch(noRecord, /⚠|regenerate .* first/);
      assert.equal(noRecord.includes("\n"), false);
    });

    it("should distinguish an unreadable package from one that never generated", () => {
      assert.equal(
        formatFreshnessAdvisory(judge("sha256:aaa", undefined)),
        "note: @packages/media-core's sources could not be re-read — whether its artifacts predate them is unknown.",
      );
    });

    /**
     * The safety valve's line, and the count is the whole of its usefulness.
     *
     * A developer told only that their package "could not be re-read" would go looking for a
     * permissions problem. The number is what says the actual thing: `scanDirs` is pointed at
     * something far wider than one package's sources, which is why the check declined rather than
     * spending minutes fingerprinting the wrong files.
     */
    it("should name the count when the scan set breached the ceiling", () => {
      const advisory = formatFreshnessAdvisory(
        judgeFreshness({
          name: LIB,
          sourceId: LIB,
          record: { outcome: "success", at: "2026-08-23T11:00:00.000Z", inputsHash: "sha256:aaa" },
          currentHash: undefined,
          currentUnknown: {
            reason: "source-set-too-large",
            detail: "41234 files resolved, over the 5000-file ceiling",
          },
        }),
      );

      assert.equal(
        advisory,
        "note: @packages/media-core's scan set is too large to fingerprint (41234 files resolved, over the 5000-file ceiling) — whether its artifacts predate its sources is unknown. Narrow that package's discovery.scanDirs.",
      );
      assert.doesNotMatch(advisory, /⚠/);
      assert.equal(advisory.includes("\n"), false);
    });

    /**
     * A hash that exists is the answer. A producer may report a reason alongside one — the ceiling
     * check runs before hashing, so it never does today — and a verdict that let the reason win
     * would turn a perfectly good comparison into an advisory.
     */
    it("should ignore a reported reason when the sources did fingerprint", () => {
      const freshness = judgeFreshness({
        name: LIB,
        sourceId: LIB,
        record: { outcome: "success", at: "2026-08-23T11:00:00.000Z", inputsHash: "sha256:aaa" },
        currentHash: "sha256:aaa",
        currentUnknown: { reason: "source-set-too-large", detail: "ignored" },
      });

      assert.equal(freshness.currentMatches, true);
      assert.equal(freshness.unknownReason, undefined);
      assert.equal(freshness.unknownDetail, undefined);
    });
  });
});

describe("the inline caveat", () => {
  describe("When a finding rests on a package that may be stale", () => {
    it("should be one line naming the package and what to distrust", () => {
      assert.equal(
        formatFreshnessCaveat([LIB]),
        "note: @packages/media-core may be stale; this finding may describe the old world",
      );
    });

    it("should name the local package in full, having no banner beside it for context", () => {
      const local = judge("sha256:aaa", "sha256:bbb", {
        name: "@apps/api",
        sourceId: "local",
      });

      // `this app` alone is unambiguous under a banner and ambiguous in a wall of findings.
      assert.equal(caveatNameFor(local), "@apps/api (this app)");
      assert.equal(
        formatFreshnessCaveat([caveatNameFor(local)]),
        "note: @apps/api (this app) may be stale; this finding may describe the old world",
      );
    });

    it("should carry no colour, so the text is the text in every terminal", () => {
      // eslint-disable-next-line no-control-regex
      assert.doesNotMatch(formatFreshnessCaveat([LIB]), /\[/);
    });
  });
});

describe("the --json projection", () => {
  describe("When freshness is published as data", () => {
    it("should carry name, outcome, generatedAt and currentMatches", () => {
      assert.deepEqual(toFreshnessJson([judge("sha256:aaa", "sha256:bbb")]), [
        {
          name: LIB,
          outcome: "success",
          generatedAt: "2026-08-23T11:00:00.000Z",
          currentMatches: false,
        },
      ]);
    });

    it("should OMIT currentMatches when nothing could be concluded, never emit false", () => {
      const [entry] = toFreshnessJson([
        judgeFreshness({ name: LIB, sourceId: LIB, record: undefined, currentHash: undefined }),
      ]);

      // `false` is a finding; absence is the admission there is nothing to report. A consumer
      // gating on `currentMatches === false` must not be handed unknowns.
      assert.deepEqual(entry, { name: LIB });
    });
  });
});
