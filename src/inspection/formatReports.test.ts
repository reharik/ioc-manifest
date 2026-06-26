import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatDiscoveryReport,
  formatRegistrationLifetimeInspect,
} from "./formatReports.js";
import type { DiscoveryReport } from "./reports.js";
import type { ResolvedContractRegistration } from "../generator/resolveRegistrationPlan.js";

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

describe("formatRegistrationLifetimeInspect", () => {
  describe("When plan entries include lifetimeSource", () => {
    it("should print resolved lifetime and lifetimeSource per implementation", () => {
      const plan: ResolvedContractRegistration[] = [
        {
          contractName: "X",
          contractTypeRelImport: "x",
          contractKey: "x",
          accessKey: "x",
          defaultImplementationName: "a",
          implementations: [
            {
              implementationName: "a",
              registrationKey: "a",
              exportName: "buildA",
              modulePath: "a.ts",
              relImport: "./a",
              lifetime: "scoped",
              lifetimeSource: "discovery-root",
            },
          ],
        },
      ];
      const text = formatRegistrationLifetimeInspect(plan);
      assert.ok(text.includes("lifetime: scoped"));
      assert.ok(text.includes("lifetimeSource: discovery-root"));
    });
  });
});
