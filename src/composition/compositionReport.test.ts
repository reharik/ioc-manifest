import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildValidationReport,
  formatValidationReportJson,
  formatValidationReportText,
} from "./compositionReport.js";

describe("formatValidationReport", () => {
  describe("When issues are present", () => {
    it("should format text and parseable JSON", () => {
      const report = buildValidationReport([
        {
          category: "externals",
          severity: "error",
          summary: "Unsatisfied external",
          details: ["detail line"],
          suggestedFix: "fix it",
        },
      ]);
      // `color: false` is pinned, not incidental: this asserts the plain-text layout, so it must
      // not depend on whether the suite's stdout happens to be a terminal.
      const text = formatValidationReportText(report, { color: false });
      assert.match(text, /\[externals\]/);
      assert.match(text, /Validation failed: 1 error/);

      const parsed = JSON.parse(formatValidationReportJson(report)) as {
        issues: unknown[];
      };
      assert.equal(parsed.issues.length, 1);
    });
  });

  describe("When an issue's category is documented", () => {
    it("should carry the pointer in text and in JSON, and print the tag exactly once", () => {
      const report = buildValidationReport([
        {
          category: "externals",
          severity: "error",
          summary: 'Unsatisfied: nothing supplies "logger", which @lib/a expects.',
          details: ['key:       "logger"  demanded by @lib/a'],
          suggestedFix: "fix it",
        },
      ]);

      const text = formatValidationReportText(report, { color: false });

      // The regression: the check used to embed `[externals] ` in its own summary while the
      // renderer prefixed the category too, so the line read `[externals] [externals] …`.
      assert.equal(text.match(/\[externals\]/g)?.length, 1);
      assert.match(text, /^\[externals\] Unsatisfied: nothing supplies/m);
      assert.match(text, /→ docs: https:\/\/.*monorepo\/composition#externals/);

      const parsed = JSON.parse(formatValidationReportJson(report)) as {
        issues: { docUrl?: string }[];
      };
      assert.equal(
        parsed.issues[0]!.docUrl,
        "https://reharik.github.io/ioc-manifest/monorepo/composition#externals",
      );
    });

    it("should keep colour out of JSON and out of plain text", () => {
      const report = buildValidationReport([
        {
          category: "app-config",
          severity: "warning",
          summary: "something",
          details: [],
        },
      ]);

      const plain = formatValidationReportText(report, { color: false });
      const coloured = formatValidationReportText(report, { color: true });

      assert.ok(!plain.includes("\u001b"));
      assert.ok(coloured.includes("\u001b"));
      // A warning says so in words, not only in colour — a piped log has no colour left.
      assert.match(plain, /^\[app-config\] \(warning\) something$/m);
      assert.ok(!formatValidationReportJson(report).includes("\u001b"));
    });
  });

  describe("When there are no issues", () => {
    it("should report success", () => {
      const text = formatValidationReportText(buildValidationReport([]));
      assert.match(text, /Validation passed/);
    });
  });
});
