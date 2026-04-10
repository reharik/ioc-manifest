import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDiscoveryReport } from "./formatReports.js";
import type { DiscoveryReport } from "./reports.js";

describe("formatDiscoveryReport", () => {
  describe("When color is disabled", () => {
    it("should not embed ANSI escape sequences", () => {
      const report: DiscoveryReport = {
        files: [
          {
            modulePath: "src/a.ts",
            rows: [
              {
                modulePath: "src/a.ts",
                exportName: "buildA",
                status: "discovered",
                contractName: "A",
                registrationKey: "a",
              },
              {
                modulePath: "src/a.ts",
                exportName: "other",
                status: "skipped",
                skipReason: "no_factory_pattern_in_source",
              },
            ],
          },
        ],
      };

      const text = formatDiscoveryReport(report, { color: false });

      assert.ok(!/\x1b\[/u.test(text));
    });
  });
});
