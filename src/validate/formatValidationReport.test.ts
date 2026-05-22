import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildValidationReport,
  formatValidationReportJson,
  formatValidationReportText,
} from "./formatValidationReport.js";

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
      const text = formatValidationReportText(report);
      assert.match(text, /\[externals\]/);
      assert.match(text, /Validation failed: 1 error/);

      const parsed = JSON.parse(formatValidationReportJson(report)) as unknown[];
      assert.equal(parsed.length, 1);
    });
  });

  describe("When there are no issues", () => {
    it("should report success", () => {
      const text = formatValidationReportText(buildValidationReport([]));
      assert.match(text, /Validation passed/);
    });
  });
});
