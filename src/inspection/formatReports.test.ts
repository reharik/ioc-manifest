import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatDiscoveryReport,
  formatInspectionReport,
} from "./formatReports.js";
import { buildInspectionReport } from "./reports.js";
import { formatInspectionReportJson } from "./reportJson.js";
import type {
  DiscoveryExportReportRow,
  DiscoveryReport,
  InspectionReport,
} from "./reports.js";

const summary = (
  overrides?: Partial<DiscoveryReport["summary"]>,
): DiscoveryReport["summary"] => ({
  filesScanned: 1,
  unitsDiscovered: 1,
  nearMisses: 1,
  notACandidateFiles: 0,
  filesExcludedByConfig: 0,
  ...overrides,
});

const reportOf = (
  rows: readonly DiscoveryExportReportRow[],
  overrides?: Partial<DiscoveryReport>,
): DiscoveryReport => ({
  files: [{ modulePath: "src/a.ts", rows }],
  scopeRoots: [],
  scopeRootSharedUnits: [],
  groups: [],
  excludedByConfig: [],
  summary: summary(),
  ...overrides,
});

const discoveredRow: DiscoveryExportReportRow = {
  modulePath: "src/a.ts",
  exportName: "buildA",
  status: "discovered",
  contractName: "A",
  registrationKey: "a",
  lifetime: "scoped",
  lifetimeSource: "lifetime-marker",
};

const nearMissRow: DiscoveryExportReportRow = {
  modulePath: "src/a.ts",
  exportName: "buildSmsChannel",
  status: "skipped",
  skipReason: "contract_not_imported",
  partition: "near_miss",
  contractName: "ISmsChannel",
  gloss: "the annotated return type is not imported in this file",
};

const notACandidateRow: DiscoveryExportReportRow = {
  modulePath: "src/a.ts",
  exportName: "other",
  status: "skipped",
  skipReason: "no_factory_pattern_in_source",
  partition: "not_a_candidate",
};

describe("formatDiscoveryReport", () => {
  describe("When color is disabled", () => {
    it("should not embed ANSI escape sequences", () => {
      const text = formatDiscoveryReport(
        reportOf([discoveredRow, notACandidateRow]),
        { color: false },
      );

      assert.ok(!/\x1b\[/u.test(text));
    });
  });

  describe("When a discovered row is rendered", () => {
    it("should put contract, key, lifetime and lifetime source on one line", () => {
      const text = formatDiscoveryReport(reportOf([discoveredRow]), {
        color: false,
      });

      assert.match(
        text,
        /^ {2}✔ buildA → A {2}key: a {2}scoped \(lifetime-marker\)$/m,
      );
    });
  });

  describe("When a near-miss row is rendered", () => {
    it("should carry the verbatim code on the row and the gloss beneath it", () => {
      const text = formatDiscoveryReport(reportOf([nearMissRow]), {
        color: false,
      });

      assert.match(
        text,
        /^ {2}✖ buildSmsChannel → ISmsChannel {2}contract_not_imported$/m,
      );
      assert.match(
        text,
        /^ {6}→ the annotated return type is not imported in this file$/m,
      );
    });
  });

  describe("When a scope-root row is rendered", () => {
    it("should carry the declared lbv keys and the verification verdict", () => {
      const text = formatDiscoveryReport(
        reportOf([
          {
            modulePath: "src/a.ts",
            exportName: "buildAuthRouter",
            status: "discovered",
            contractName: "IRouter",
            registrationKey: "authRouter",
            isScopeRoot: true,
            declaredLbv: "{ viewerId: string; uow: UnitOfWork }",
            declaredLbvKeys: ["viewerId", "uow"],
            scopeRootVerification: {
              satisfied: true,
              scopeDemands: [],
              generationResolvedKeys: [],
              unusedDeclaredKeys: [],
              blindComposedPackages: [],
              findings: [],
            },
          },
        ]),
        { color: false },
      );

      assert.match(
        text,
        /^ {2}⬢ buildAuthRouter → IRouter \[scope root\] {2}lbv: viewerId, uow {2}✔ satisfied$/m,
      );
    });
  });

  describe("When the default (non-verbose) view is rendered", () => {
    it("should hide not-a-candidate rows and omit files that hold only those", () => {
      const report: DiscoveryReport = {
        files: [
          { modulePath: "src/a.ts", rows: [discoveredRow, notACandidateRow] },
          { modulePath: "src/only-noise.ts", rows: [notACandidateRow] },
        ],
        scopeRoots: [],
        scopeRootSharedUnits: [],
        groups: [],
        excludedByConfig: [],
        summary: summary({
          filesScanned: 2,
          nearMisses: 0,
          notACandidateFiles: 1,
        }),
      };

      const text = formatDiscoveryReport(report, { color: false });

      assert.ok(text.includes("src/a.ts"));
      assert.ok(!text.includes("src/only-noise.ts"));
      assert.ok(!text.includes("no_factory_pattern_in_source"));
      assert.ok(text.includes("Run with --verbose"));
    });

    it("should show every row under --verbose", () => {
      const report: DiscoveryReport = {
        files: [
          { modulePath: "src/a.ts", rows: [discoveredRow] },
          { modulePath: "src/only-noise.ts", rows: [notACandidateRow] },
        ],
        scopeRoots: [],
        scopeRootSharedUnits: [],
        groups: [],
        excludedByConfig: [],
        summary: summary({ filesScanned: 2, nearMisses: 0 }),
      };

      const text = formatDiscoveryReport(report, {
        color: false,
        verbose: true,
      });

      assert.ok(text.includes("src/only-noise.ts"));
      assert.ok(text.includes("no_factory_pattern_in_source"));
    });
  });

  describe("When the footer summary is rendered", () => {
    it("should print scan counts and call out excluded-by-config on its own line", () => {
      const report = reportOf([notACandidateRow], {
        summary: summary({
          filesScanned: 7,
          unitsDiscovered: 3,
          nearMisses: 2,
          notACandidateFiles: 4,
          filesExcludedByConfig: 5,
        }),
      });

      const text = formatDiscoveryReport(report, { color: false });

      assert.match(
        text,
        /Summary: 7 file\(s\) scanned · 3 unit\(s\) discovered · 2 near-miss\(es\) · 4 not-a-candidate file\(s\)/,
      );
      assert.match(text, /^ +5 file\(s\) excluded by config$/m);
    });

    it("should print the excluded-by-config count even when its rows are hidden", () => {
      const report: DiscoveryReport = {
        files: [
          {
            modulePath: "src/legacy.ts",
            rows: [
              {
                modulePath: "src/legacy.ts",
                status: "skipped",
                skipReason: "excluded_by_config",
                partition: "not_a_candidate",
              },
            ],
          },
        ],
        scopeRoots: [],
        scopeRootSharedUnits: [],
        groups: [],
        excludedByConfig: ["src/legacy.ts"],
        summary: summary({
          filesScanned: 0,
          unitsDiscovered: 0,
          nearMisses: 0,
          notACandidateFiles: 0,
          filesExcludedByConfig: 1,
        }),
      };

      const text = formatDiscoveryReport(report, { color: false });

      assert.ok(!text.includes("src/legacy.ts"));
      assert.match(text, /1 file\(s\) excluded by config/);
    });

    it("should list excluded files as not-a-candidate rows under --verbose", () => {
      const report: DiscoveryReport = {
        files: [
          {
            modulePath: "src/legacy.ts",
            rows: [
              {
                modulePath: "src/legacy.ts",
                status: "skipped",
                skipReason: "excluded_by_config",
                partition: "not_a_candidate",
              },
            ],
          },
        ],
        scopeRoots: [],
        scopeRootSharedUnits: [],
        groups: [],
        excludedByConfig: ["src/legacy.ts"],
        summary: summary({
          filesScanned: 0,
          unitsDiscovered: 0,
          nearMisses: 0,
          notACandidateFiles: 0,
          filesExcludedByConfig: 1,
        }),
      };

      const text = formatDiscoveryReport(report, {
        color: false,
        verbose: true,
      });

      assert.ok(text.includes("src/legacy.ts"));
      assert.match(text, /^ {2}✖ \(whole file\) {2}excluded_by_config$/m);
    });
  });

  describe("When the view is filtered", () => {
    it("should note the filter and keep the full-scan counts", () => {
      const report = reportOf([discoveredRow], {
        filter: { contract: "chan" },
        summary: summary({ filesScanned: 12, unitsDiscovered: 9 }),
      });

      const text = formatDiscoveryReport(report, { color: false });

      assert.match(text, /Rows filtered by --contract "chan"/);
      assert.match(text, /12 file\(s\) scanned · 9 unit\(s\) discovered/);
    });
  });

  describe("When a groups section is rendered", () => {
    it("should list members and rejected candidates with code and gloss", () => {
      const report = reportOf([discoveredRow], {
        groups: [
          {
            groupName: "mediaStoragesGroup",
            kind: "collection",
            baseType: "MediaStorage",
            members: [{ memberName: "MediaStorage", registrationKey: "local" }],
            rejections: [
              {
                contractName: "NotInGroup",
                reason: "nominal_heritage_not_declared",
                gloss: "declares no heritage",
              },
            ],
          },
        ],
      });

      const text = formatDiscoveryReport(report, { color: false });

      assert.match(text, /mediaStoragesGroup collection of MediaStorage/);
      assert.match(text, /MediaStorage — local/);
      assert.match(
        text,
        /considered, rejected: NotInGroup \(nominal_heritage_not_declared\) — declares no heritage/,
      );
    });
  });
});

describe("formatInspectionReport", () => {
  const report: InspectionReport = {
    contracts: [
      {
        contractName: "X",
        defaultImplementationName: "a",
        defaultRegistrationKey: "a",
        implementations: [
          {
            implementationName: "a",
            registrationKey: "aKey",
            lifecycle: "scoped",
            modulePath: "src/a.ts",
            exportName: "buildA",
            isDefault: true,
          },
          {
            implementationName: "b",
            registrationKey: "bKey",
            lifecycle: "singleton",
            modulePath: "src/b.ts",
            exportName: "buildB",
            isDefault: false,
          },
        ],
      },
    ],
    manifestIssues: [],
    groups: [],
    openers: [],
    totalContractCount: 1,
  };

  describe("When implementations are rendered", () => {
    it("should show registration key, lifetime, module path, export and default marker", () => {
      const text = formatInspectionReport(report, { color: false });

      assert.match(text, /★ a\s+key: aKey\s+scoped\s+src\/a\.ts#buildA/);
      assert.match(text, /b\s+key: bKey\s+singleton\s+src\/b\.ts#buildB/);
      assert.ok(!/★ b/.test(text));
    });
  });

  describe("When groups came from the manifest", () => {
    it("should say rejections are only knowable from a discovery run", () => {
      const text = formatInspectionReport(
        {
          ...report,
          groups: [
            {
              groupName: "g",
              kind: "object",
              baseType: "B",
              members: [{ memberName: "x", registrationKey: "xKey" }],
              rejections: [],
              rejectionsUnavailable: true,
            },
          ],
        },
        { color: false },
      );

      assert.match(text, /g object of B/);
      assert.match(text, /x — xKey/);
      assert.match(text, /rejected candidates are recorded at generation/);
    });
  });

  describe("When the view is filtered", () => {
    it("should note how many contracts of the full set are shown", () => {
      const text = formatInspectionReport(
        { ...report, filter: { contract: "x" }, totalContractCount: 9 },
        { color: false },
      );

      assert.match(text, /Showing 1 of 9 contract\(s\) matching --contract "x"/);
    });
  });
});

describe("inspect — emitted scope-root openers", () => {
  const scopeRoots = {
    IRouter: {
      authRouter: {
        exportName: "buildAuthRouter",
        openerKey: "openAuthRouterScope",
        variantKey: "authRouter",
        contractName: "IRouter",
        variantName: "authRouter",
        modulePath: "routers.ts",
        relImport: "../routers.js",
        lbvKeys: ["uow", "viewerId"],
        moduleIndex: 0,
      },
    },
  };

  describe("When the manifest carries scope roots", () => {
    it("should report each opener with its contract, variant and lbv keys", () => {
      const report = buildInspectionReport({}, { scopeRoots });

      assert.deepEqual(report.openers, [
        {
          openerKey: "openAuthRouterScope",
          contractName: "IRouter",
          variantName: "authRouter",
          lbvKeys: ["uow", "viewerId"],
        },
      ]);
    });

    it("should render one row per opener", () => {
      const text = formatInspectionReport(
        buildInspectionReport({}, { scopeRoots }),
        { color: false },
      );

      // A scope-rooted contract has no contract row to hide in — it claims no cradle key and elects
      // no default — so the opener key is only discoverable here.
      assert.match(
        text,
        /Openers:\n\s+⬢ openAuthRouterScope → IRouter\s+variant: authRouter\s+lbv: uow, viewerId/,
      );
    });

    it("should carry the same record into --json", () => {
      const json = JSON.parse(
        formatInspectionReportJson(buildInspectionReport({}, { scopeRoots })),
      ) as { openers: unknown };

      assert.deepEqual(json.openers, [
        {
          openerKey: "openAuthRouterScope",
          contractName: "IRouter",
          variantName: "authRouter",
          lbvKeys: ["uow", "viewerId"],
        },
      ]);
    });
  });

  describe("When the manifest carries none", () => {
    it("should keep the section off the screen but present in --json", () => {
      const report = buildInspectionReport({});

      assert.deepEqual(report.openers, []);
      assert.ok(
        !formatInspectionReport(report, { color: false }).includes("Openers:"),
      );
      // The complete-record rule: the key is always there, empty.
      const json = JSON.parse(formatInspectionReportJson(report)) as {
        openers: unknown;
      };
      assert.deepEqual(json.openers, []);
    });
  });
});
