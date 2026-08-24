/**
 * Which findings get the caveat, and which are left alone.
 *
 * The taint is the half of this feature a skimming reader actually meets — the banner is at the top
 * of the output, the caveat is on the error they scrolled to. So the pin that matters is precision:
 * a caveat on a finding that has nothing to do with the stale package teaches the reader to ignore
 * caveats, and a missing one on the finding that IS wrong is the whole bug returning.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyFreshnessTaint } from "./freshnessPass.js";
import { judgeFreshness } from "../diagnostics/freshness.js";
import type { ValidationIssue } from "./types.js";

const LIB = "@packages/media-core";
const OTHER = "@packages/media-io";

const stale = (sourceId: string, name = sourceId) =>
  judgeFreshness({
    name,
    sourceId,
    record: { outcome: "success", at: "2026-08-23T11:00:00.000Z", inputsHash: "sha256:aaa" },
    currentHash: "sha256:bbb",
  });

const fresh = (sourceId: string, name = sourceId) =>
  judgeFreshness({
    name,
    sourceId,
    record: { outcome: "success", at: "2026-08-23T11:00:00.000Z", inputsHash: "sha256:aaa" },
    currentHash: "sha256:aaa",
  });

const issue = (
  summary: string,
  packages?: readonly string[],
): ValidationIssue => ({
  category: "externals",
  severity: "error",
  summary,
  details: [],
  ...(packages !== undefined ? { packages } : {}),
});

describe("applyFreshnessTaint", () => {
  describe("When a finding resolves through a package that may be stale", () => {
    it("should mark it and attach the caveat", () => {
      const [tainted] = applyFreshnessTaint(
        [issue("nothing supplies x", [LIB])],
        [stale(LIB)],
      );

      assert.equal(tainted!.possiblyStale, true);
      assert.equal(
        tainted!.stalenessNote,
        "note: @packages/media-core may be stale; this finding may describe the old world",
      );
    });

    it("should name every stale package the finding rests on, not just the first", () => {
      const [tainted] = applyFreshnessTaint(
        [issue("group base types disagree", [LIB, OTHER])],
        [stale(LIB), stale(OTHER)],
      );

      assert.match(tainted!.stalenessNote!, /@packages\/media-core, @packages\/media-io/);
    });
  });

  describe("When a finding resolves only through packages that are current", () => {
    it("should be left exactly as it was", () => {
      const original = issue("nothing supplies y", [OTHER]);
      const [untouched] = applyFreshnessTaint(
        [original],
        [stale(LIB), fresh(OTHER)],
      );

      // Identity, not just equality: a finding nothing is wrong with must not even be rebuilt.
      assert.equal(untouched, original);
    });
  });

  describe("When a finding carries no attribution at all", () => {
    it("should be left alone rather than tainted by default", () => {
      // `registrations.X.y.source` naming a package that is not composed is config against config
      // and reads no manifest. A caveat there would tell the reader to doubt nothing in particular.
      const original = issue("source references unknown package");
      const [untouched] = applyFreshnessTaint([original], [stale(LIB)]);

      assert.equal(untouched, original);
      assert.equal(untouched!.possiblyStale, undefined);
    });
  });

  describe("When nothing is stale", () => {
    it("should return the very same array, doing no work", () => {
      const issues = [issue("nothing supplies x", [LIB])];

      assert.equal(applyFreshnessTaint(issues, [fresh(LIB)]), issues);
      // An unknown verdict is not a stale one — the quiet advisory covers it, the taint does not.
      assert.equal(
        applyFreshnessTaint(issues, [
          judgeFreshness({ name: LIB, sourceId: LIB, record: undefined, currentHash: undefined }),
        ]),
        issues,
      );
    });
  });

  describe("When attribution is matched", () => {
    it("should match the machine token, never the rendered label", () => {
      // The local package renders as `@apps/api (this app)` in prose and carries `local` as its
      // token. Matching prose would tie the decision to how each check happens to word a sentence.
      const [tainted] = applyFreshnessTaint(
        [issue("nothing supplies z", ["local"])],
        [stale("local", "@apps/api")],
      );

      assert.equal(tainted!.possiblyStale, true);
      assert.match(tainted!.stalenessNote!, /@apps\/api \(this app\) may be stale/);
    });
  });
});
