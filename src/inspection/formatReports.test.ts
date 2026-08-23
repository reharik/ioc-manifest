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
  InspectionGroupReport,
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
    const groupWith = (
      rejections: InspectionGroupReport["rejections"],
    ): InspectionGroupReport => ({
      groupName: "mediaStoragesGroup",
      kind: "collection",
      baseType: "MediaStorage",
      members: [{ memberName: "MediaStorage", registrationKey: "local" }],
      rejections,
    });

    it("should list members and any rejection the predicate calls informative", () => {
      const report = reportOf([discoveredRow], {
        groups: [
          groupWith([
            {
              contractName: "NotInGroup",
              reason: "contract_type_unresolved",
              gloss: "declared type could not be loaded",
              informative: true,
            },
          ]),
        ],
      });

      const text = formatDiscoveryReport(report, { color: false });

      assert.match(text, /mediaStoragesGroup collection of MediaStorage/);
      assert.match(text, /MediaStorage — local/);
      assert.match(
        text,
        /considered, rejected: NotInGroup \(contract_type_unresolved\) — declared type could not be loaded/,
      );
    });

    it("should collapse stock rejections to one counted line per reason", () => {
      const report = reportOf([discoveredRow], {
        groups: [
          groupWith(
            ["UserRepository", "OrderRepository", "Clock"].map((name) => ({
              contractName: name,
              reason: "nominal_heritage_not_declared" as const,
              gloss: "declares no heritage",
              informative: false,
            })),
          ),
        ],
      });

      const text = formatDiscoveryReport(report, { color: false });

      assert.match(
        text,
        /considered, rejected: 3 \(nominal_heritage_not_declared\) — use --contract <name> for a specific verdict/,
      );
      assert.ok(!/UserRepository/.test(text));
      assert.match(text, /--verbose to show 3 collapsed group rejection\(s\)/);
    });

    it("should say why an informative stock rejection earned its line", () => {
      const report = reportOf([discoveredRow], {
        groups: [
          groupWith([
            {
              contractName: "LooksLikeOne",
              reason: "nominal_heritage_not_declared",
              gloss: "declares no heritage",
              structurallyAssignable: true,
              informative: true,
            },
            {
              contractName: "WasAMember",
              reason: "nominal_heritage_not_declared",
              gloss: "declares no heritage",
              wasMember: true,
              informative: true,
            },
          ]),
        ],
      });

      const text = formatDiscoveryReport(report, { color: false });

      assert.match(
        text,
        /LooksLikeOne .*— has the base's shape but declares no heritage to it/,
      );
      assert.match(
        text,
        /WasAMember .*— was a member in the generated manifest; this scan drops it/,
      );
    });

    it("should print every rejection under --verbose", () => {
      const report = reportOf([discoveredRow], {
        groups: [
          groupWith([
            {
              contractName: "UserRepository",
              reason: "nominal_heritage_not_declared",
              gloss: "declares no heritage",
              informative: false,
            },
          ]),
        ],
      });

      const text = formatDiscoveryReport(report, {
        color: false,
        verbose: true,
      });

      assert.match(
        text,
        /considered, rejected: UserRepository \(nominal_heritage_not_declared\)/,
      );
      assert.ok(!/use --contract <name>/.test(text));
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
            claimsDefault: true,
          },
          {
            implementationName: "b",
            registrationKey: "bKey",
            lifecycle: "singleton",
            modulePath: "src/b.ts",
            exportName: "buildB",
            isDefault: false,
            claimsDefault: false,
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

/**
 * The default marker only earns its place where the default was actually contested.
 *
 * A project's contracts are overwhelmingly single-implementation, and those default by arithmetic.
 * Badging them puts the same mark on every healthy row, which is how a real ambiguity — two
 * implementations of one contract, neither winning — ends up looking exactly like the twenty-five
 * rows above it.
 */
describe("formatInspectionReport default marker", () => {
  const impl = (
    implementationName: string,
    overrides?: { isDefault?: boolean; claimsDefault?: boolean },
  ): InspectionReport["contracts"][number]["implementations"][number] => ({
    implementationName,
    registrationKey: `${implementationName}Key`,
    lifecycle: "singleton",
    modulePath: `src/${implementationName}.ts`,
    exportName: `build${implementationName}`,
    isDefault: overrides?.isDefault ?? false,
    claimsDefault: overrides?.claimsDefault ?? false,
  });

  const contractReport = (
    contract: InspectionReport["contracts"][number],
  ): InspectionReport => ({
    contracts: [contract],
    manifestIssues: [],
    groups: [],
    openers: [],
    totalContractCount: 1,
  });

  const render = (contract: InspectionReport["contracts"][number]): string =>
    formatInspectionReport(contractReport(contract), { color: false });

  describe("When a contract has a single implementation", () => {
    it("should render no default marker at all", () => {
      const text = render({
        contractName: "Logger",
        defaultImplementationName: "sole",
        defaultRegistrationKey: "soleKey",
        implementations: [impl("sole", { isDefault: true, claimsDefault: true })],
      });

      assert.ok(!text.includes("★"));
      assert.ok(!/default/u.test(text));
      assert.match(text, /sole\s+key: soleKey/u);
    });
  });

  describe("When a contract has several implementations and one default", () => {
    it("should mark the winner and leave the others unmarked", () => {
      const text = render({
        contractName: "Reader",
        defaultImplementationName: "rest",
        defaultRegistrationKey: "restKey",
        implementations: [
          impl("graph"),
          impl("rest", { isDefault: true, claimsDefault: true }),
        ],
      });

      assert.match(text, /★ rest\s+key: restKey/u);
      assert.ok(!/★ graph/u.test(text));
      assert.ok(!text.includes("AMBIGUOUS"));
    });

    it("should mark a winner elected by the contract key rather than by a flag", () => {
      // Nobody set `default: true`, yet generation elects the contract-key registration. Calling
      // that a conflict would report a failure generation does not have.
      const text = render({
        contractName: "Reader",
        defaultImplementationName: "reader",
        defaultRegistrationKey: "reader",
        implementations: [impl("graph"), impl("reader", { isDefault: true })],
      });

      assert.match(text, /★ reader/u);
      assert.ok(!text.includes("no default among"));
    });
  });

  describe("When several implementations claim the default", () => {
    it("should shout the ambiguity on every claiming row", () => {
      const text = render({
        contractName: "AuthMiddleware",
        defaultImplementationName: undefined,
        defaultRegistrationKey: undefined,
        implementations: [
          impl("jwtAuth", { claimsDefault: true }),
          impl("sessionAuth", { claimsDefault: true }),
        ],
      });

      const lines = text
        .split("\n")
        .filter((line) => /jwtAuth|sessionAuth/u.test(line));
      assert.strictEqual(lines.length, 2);
      for (const line of lines) {
        assert.match(line, /✖/u);
        assert.match(line, /\(default: AMBIGUOUS — 2 of 2 claim it\)/u);
      }
    });

    it("should leave a non-claiming sibling out of the conflict", () => {
      const text = render({
        contractName: "AuthMiddleware",
        defaultImplementationName: undefined,
        defaultRegistrationKey: undefined,
        implementations: [
          impl("basicAuth"),
          impl("jwtAuth", { claimsDefault: true }),
          impl("sessionAuth", { claimsDefault: true }),
        ],
      });

      const lineFor = (name: string): string =>
        text.split("\n").find((line) => line.includes(name))!;

      assert.match(lineFor("jwtAuth"), /\(default: AMBIGUOUS — 2 of 3 claim it\)/u);
      assert.match(lineFor("sessionAuth"), /\(default: AMBIGUOUS — 2 of 3 claim it\)/u);
      assert.ok(!/AMBIGUOUS/u.test(lineFor("basicAuth")));
      assert.ok(!lineFor("basicAuth").includes("✖"));
    });
  });

  describe("When several implementations exist and none is elected", () => {
    it("should say so loudly on every row", () => {
      const text = render({
        contractName: "AuthMiddleware",
        defaultImplementationName: undefined,
        defaultRegistrationKey: undefined,
        implementations: [impl("jwtAuth"), impl("sessionAuth")],
      });

      const lines = text
        .split("\n")
        .filter((line) => /jwtAuth|sessionAuth/u.test(line));
      assert.strictEqual(lines.length, 2);
      for (const line of lines) {
        assert.match(line, /✖/u);
        assert.match(line, /\(no default among 2\)/u);
      }
      assert.ok(!text.includes("AMBIGUOUS"));
    });
  });

  describe("When the same reports are rendered as JSON", () => {
    it("should carry isDefault and claimsDefault per row regardless of the marker rule", () => {
      // The marker rule is a human-rendering decision. The record stays complete: a single
      // implementation still reports `isDefault: true` in JSON even though it prints no marker.
      const single = contractReport({
        contractName: "Logger",
        defaultImplementationName: "sole",
        defaultRegistrationKey: "soleKey",
        implementations: [impl("sole", { isDefault: true, claimsDefault: true })],
      });

      const json = JSON.parse(formatInspectionReportJson(single)) as {
        contracts: readonly {
          implementations: readonly {
            isDefault: boolean;
            claimsDefault?: boolean;
          }[];
        }[];
      };

      assert.strictEqual(
        json.contracts[0]!.implementations[0]!.isDefault,
        true,
      );
      assert.ok(!formatInspectionReport(single, { color: false }).includes("★"));
    });
  });
});

describe("formatDiscoveryReport default marker", () => {
  const row = (
    exportName: string,
    overrides?: Partial<DiscoveryExportReportRow>,
  ): DiscoveryExportReportRow => ({
    modulePath: "src/a.ts",
    exportName,
    status: "discovered",
    contractName: "Reader",
    registrationKey: exportName,
    lifetime: "singleton",
    ...overrides,
  });

  describe("When a contract had more than one implementation to choose between", () => {
    it("should mark only the elected one", () => {
      const text = formatDiscoveryReport(
        reportOf([row("graphReader"), row("restReader", { isDefault: true })]),
        { color: false },
      );

      const lineFor = (name: string): string =>
        text.split("\n").find((line) => line.includes(name))!;

      assert.match(lineFor("restReader"), /★ default/u);
      assert.ok(!/★ default/u.test(lineFor("graphReader")));
    });
  });

  describe("When a contract has a single implementation", () => {
    it("should render no default marker", () => {
      // `buildPlanJoin` never sets `isDefault` for a sole implementation, so nothing to mark.
      const text = formatDiscoveryReport(reportOf([row("soleReader")]), {
        color: false,
      });

      assert.ok(!text.includes("★"));
    });
  });
});
