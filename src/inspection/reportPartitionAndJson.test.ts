/**
 * Report-builder behaviour that the formatter then presents: partition classification (including
 * the conditional `class_abstract` promotion), footer counts, the `--contract` filter, and the
 * `--json` payload.
 *
 * The `--json` invariant pinned here is the one that keeps the two output modes honest: the human
 * screen is partitioned, the JSON is not. `--verbose` therefore cannot change a byte of JSON.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IocDiscoverySkipReason,
  IocDiscoveryStatus,
  type IocDiscoveryAnalysisFiles,
} from "../generator/discoverFactories/discoveryOutcomeTypes.js";
import { formatDiscoveryReport, formatInspectionReport } from "./formatReports.js";
import {
  formatDiscoveryReportJson,
  formatInspectionReportJson,
} from "./reportJson.js";
import {
  buildDiscoveryReport,
  buildInspectionReport,
  filterDiscoveryReportByContract,
  filterInspectionReportByContract,
} from "./reports.js";
import type { IocContractManifest } from "../core/manifest.js";

const files: IocDiscoveryAnalysisFiles = [
  {
    modulePath: "src/channels/emailChannel.ts",
    outcomes: [
      {
        scope: "export",
        exportName: "buildEmailChannel",
        status: IocDiscoveryStatus.DISCOVERED,
        contractName: "IChannel",
        implementationName: "emailChannel",
        registrationKey: "emailChannel",
        discoveredBy: "naming",
      },
      {
        scope: "export",
        exportName: "buildSmsChannel",
        status: IocDiscoveryStatus.SKIPPED,
        skipReason: IocDiscoverySkipReason.CONTRACT_NOT_IMPORTED,
        contractName: "ISmsChannel",
      },
    ],
  },
  {
    modulePath: "src/util/noise.ts",
    outcomes: [
      {
        scope: "file",
        status: IocDiscoveryStatus.SKIPPED,
        skipReason: IocDiscoverySkipReason.NO_MATCHING_EXPORT,
      },
    ],
  },
];

/**
 * Excluded files are supplied separately, never as discovery outcomes: an excluded file never
 * enters the scan set, so the scanner has no occasion to emit `excluded_by_config` for it.
 */
const EXCLUDED = ["src/util/excluded.ts"];

const buildBaseReport = () =>
  buildDiscoveryReport({
    discoveryFiles: files,
    excludedFiles: EXCLUDED,
    registrationPlan: [
      {
        contractName: "IChannel",
        contractTypeRelImport: "../channels/emailChannel.js",
        contractKey: "iChannel",
        accessKey: "iChannel",
        defaultImplementationName: "emailChannel",
        implementations: [
          {
            implementationName: "emailChannel",
            registrationKey: "emailChannel",
            exportName: "buildEmailChannel",
            modulePath: "src/channels/emailChannel.ts",
            relImport: "../channels/emailChannel.js",
            lifetime: "scoped",
            lifetimeSource: "lifetime-marker",
          },
        ],
      },
    ],
  });

describe("discovery report partition", () => {
  describe("When rows are classified", () => {
    it("should label skipped rows and count the scan in the footer summary", () => {
      const report = buildBaseReport();

      const rows = report.files.flatMap((f) => f.rows);
      const near = rows.find((r) => r.exportName === "buildSmsChannel");
      assert.equal(near?.partition, "near_miss");
      assert.match(
        near?.gloss ?? "",
        /^the annotated return type is not imported in this file/,
      );

      const noise = rows.find((r) => r.exportName === undefined);
      assert.equal(noise?.partition, "not_a_candidate");

      // The excluded file is counted on its own line and kept out of `filesScanned`: it never
      // entered the scan, so calling it scanned would restore the lie this count exists to remove.
      assert.deepEqual(report.summary, {
        filesScanned: 2,
        unitsDiscovered: 1,
        nearMisses: 1,
        notACandidateFiles: 1,
        filesExcludedByConfig: 1,
      });
      assert.deepEqual(report.excludedByConfig, ["src/util/excluded.ts"]);
    });

    it("should render an excluded file as a not-a-candidate row nothing else emits", () => {
      const excludedRow = buildBaseReport()
        .files.find((f) => f.modulePath === "src/util/excluded.ts")
        ?.rows[0];

      assert.equal(excludedRow?.skipReason, "excluded_by_config");
      assert.equal(excludedRow?.partition, "not_a_candidate");
      assert.equal(excludedRow?.exportName, undefined);
    });

    it("should join the resolved lifetime onto the discovered row", () => {
      const row = buildBaseReport()
        .files.flatMap((f) => f.rows)
        .find((r) => r.exportName === "buildEmailChannel");

      assert.equal(row?.lifetime, "scoped");
      assert.equal(row?.lifetimeSource, "lifetime-marker");
    });
  });

  describe("When an abstract class declares a contract", () => {
    const abstractScan = (registeredByConcrete: boolean) =>
      buildDiscoveryReport([
        {
          modulePath: "src/base.ts",
          outcomes: [
            {
              scope: "export",
              exportName: "BaseThing",
              status: IocDiscoveryStatus.SKIPPED,
              skipReason: IocDiscoverySkipReason.CLASS_ABSTRACT,
              contractName: "Thing",
            },
          ],
        },
        ...(registeredByConcrete
          ? [
              {
                modulePath: "src/concrete.ts",
                outcomes: [
                  {
                    scope: "export" as const,
                    exportName: "ConcreteThing",
                    status: IocDiscoveryStatus.DISCOVERED,
                    contractName: "Thing",
                    implementationName: "concreteThing",
                    registrationKey: "concreteThing",
                    discoveredBy: "implements" as const,
                  },
                ],
              },
            ]
          : []),
      ]);

    it("should stay a not-a-candidate when something concrete registers the contract", () => {
      const row = abstractScan(true).files[0]!.rows[0]!;
      assert.equal(row.partition, "not_a_candidate");
    });

    it("should be promoted to a near-miss when nothing concrete registers it", () => {
      const row = abstractScan(false).files[0]!.rows[0]!;
      assert.equal(row.partition, "near_miss");
      assert.ok(row.gloss !== undefined);
    });
  });
});

describe("--contract filter", () => {
  describe("When a discovery report is filtered", () => {
    it("should keep matching rows and carry the full-scan summary", () => {
      const filtered = filterDiscoveryReportByContract(
        buildBaseReport(),
        "sms",
      );

      assert.deepEqual(
        filtered.files.flatMap((f) => f.rows.map((r) => r.exportName)),
        ["buildSmsChannel"],
      );
      assert.deepEqual(filtered.filter, { contract: "sms" });
      assert.equal(filtered.summary.filesScanned, 2);
      // The exclusion list is a statement about the config, not about the selected rows.
      assert.deepEqual(filtered.excludedByConfig, ["src/util/excluded.ts"]);
      assert.match(
        formatDiscoveryReport(filtered, { color: false }),
        /Rows filtered by --contract "sms"/,
      );
    });

    it("should match contract names case-insensitively and drop non-matching files", () => {
      const filtered = filterDiscoveryReportByContract(
        buildBaseReport(),
        "ichannel",
      );

      assert.deepEqual(
        filtered.files.map((f) => f.modulePath),
        ["src/channels/emailChannel.ts"],
      );
      assert.deepEqual(
        filtered.files[0]!.rows.map((r) => r.exportName),
        ["buildEmailChannel"],
      );
    });

    it("should return no rows when nothing matches", () => {
      const filtered = filterDiscoveryReportByContract(
        buildBaseReport(),
        "zzz-nothing",
      );

      assert.deepEqual(filtered.files, []);
      assert.equal(filtered.summary.unitsDiscovered, 1);
    });
  });

  describe("When an inspection report is filtered", () => {
    const manifest: IocContractManifest = {
      MediaStorage: {
        local: {
          exportName: "buildLocalMediaStorage",
          registrationKey: "localMediaStorage",
          modulePath: "src/media/buildLocalMediaStorage.ts",
          relImport: "../media/buildLocalMediaStorage.js",
          contractName: "MediaStorage",
          implementationName: "local",
          lifetime: "singleton",
          moduleIndex: 0,
          default: true,
        },
      },
      Logger: {
        console: {
          exportName: "buildConsoleLogger",
          registrationKey: "consoleLogger",
          modulePath: "src/log/buildConsoleLogger.ts",
          relImport: "../log/buildConsoleLogger.js",
          contractName: "Logger",
          implementationName: "console",
          lifetime: "singleton",
          moduleIndex: 1,
          default: true,
        },
      },
    };

    it("should keep matching contracts and report the full count", () => {
      const filtered = filterInspectionReportByContract(
        buildInspectionReport(manifest),
        "media",
      );

      assert.deepEqual(
        filtered.contracts.map((c) => c.contractName),
        ["MediaStorage"],
      );
      assert.equal(filtered.totalContractCount, 2);
      assert.match(
        formatInspectionReport(filtered, { color: false }),
        /Showing 1 of 2 contract\(s\)/,
      );
    });

    it("should return no contracts when nothing matches", () => {
      const filtered = filterInspectionReportByContract(
        buildInspectionReport(manifest),
        "zzz-nothing",
      );

      assert.deepEqual(filtered.contracts, []);
      assert.match(
        formatInspectionReport(filtered, { color: false }),
        /Showing 0 of 2 contract\(s\)/,
      );
    });
  });
});

describe("--json output", () => {
  describe("When a discovery report is serialized", () => {
    it("should parse, keep hidden rows, and label every row's partition", () => {
      const parsed = JSON.parse(
        formatDiscoveryReportJson(buildBaseReport()),
      ) as {
        kind: string;
        files: {
          modulePath: string;
          rows: {
            exportName?: string;
            partition?: string;
            skipReason?: string;
          }[];
        }[];
        excludedByConfig: string[];
        summary: Record<string, number>;
      };

      assert.equal(parsed.kind, "inspect-discovery");
      const rows = parsed.files.flatMap((f) => f.rows);
      assert.equal(rows.length, 4);
      // Hidden on the default screen, present in the record: the two not-a-candidate rows and the
      // excluded file all survive serialization, each labelled with its own partition.
      assert.ok(rows.some((r) => r.skipReason === "no_matching_export"));
      assert.ok(rows.some((r) => r.skipReason === "excluded_by_config"));
      for (const row of rows) {
        if (row.exportName === "buildEmailChannel") continue;
        assert.ok(
          row.partition === "near_miss" || row.partition === "not_a_candidate",
        );
      }
      assert.deepEqual(parsed.excludedByConfig, ["src/util/excluded.ts"]);
      assert.equal(parsed.summary.filesScanned, 2);
      assert.equal(parsed.summary.filesExcludedByConfig, 1);
    });

    it("should be identical with and without --verbose", () => {
      // Mirrors the CLI's own branch: verbosity is a screen concern that reaches the text
      // formatter and nothing else, so the partition cannot leak into JSON content.
      const render = (json: boolean, verbose: boolean): string => {
        const report = buildBaseReport();
        return json
          ? formatDiscoveryReportJson(report)
          : formatDiscoveryReport(report, { color: false, verbose });
      };

      assert.equal(render(true, false), render(true, true));
      assert.notEqual(render(false, false), render(false, true));
    });

    it("should carry groups with members, rejections and scope-root verification", () => {
      const report = buildDiscoveryReport({
        discoveryFiles: files,
        groupPlans: [
          {
            groupName: "grouped",
            kind: "collection",
            baseType: "BaseA",
            baseTypeId: "id",
            members: [
              { contractName: "InGroupA", registrationKey: "inGroupA" },
            ],
            rejections: [
              {
                contractName: "NotInGroup",
                reason: "nominal_heritage_not_declared",
              },
            ],
          },
        ],
        scopeRoots: [],
        scopeRootSharedUnits: [],
      });

      const parsed = JSON.parse(formatDiscoveryReportJson(report)) as {
        groups: {
          members: { memberName: string }[];
          rejections: { reason: string; gloss: string }[];
        }[];
        scopeRoots: unknown[];
      };

      assert.deepEqual(parsed.groups[0]!.members, [
        { memberName: "InGroupA", registrationKey: "inGroupA" },
      ]);
      assert.equal(
        parsed.groups[0]!.rejections[0]!.reason,
        "nominal_heritage_not_declared",
      );
      assert.ok(parsed.groups[0]!.rejections[0]!.gloss.length > 0);
      assert.deepEqual(parsed.scopeRoots, []);
    });

    it("should keep every rejection in JSON, each labelled with the render verdict", () => {
      const report = buildDiscoveryReport({
        discoveryFiles: files,
        groupPlans: [
          {
            groupName: "grouped",
            kind: "collection",
            baseType: "BaseA",
            baseTypeId: "id",
            members: [],
            rejections: [
              {
                contractName: "NeverACandidate",
                reason: "nominal_heritage_not_declared",
                structurallyAssignable: false,
              },
              {
                contractName: "ShapedLikeTheBase",
                reason: "nominal_heritage_not_declared",
                structurallyAssignable: true,
              },
              { contractName: "WasAMember", reason: "nominal_heritage_not_declared" },
            ],
          },
        ],
        // The manifest on disk called `WasAMember` a member, so this scan is dropping it.
        priorGroupMembers: new Map([["grouped", new Set(["WasAMember"])]]),
        scopeRoots: [],
        scopeRootSharedUnits: [],
      });

      const parsed = JSON.parse(formatDiscoveryReportJson(report)) as {
        groups: {
          rejections: {
            contractName: string;
            informative: boolean;
            wasMember?: boolean;
          }[];
        }[];
      };
      const rejections = parsed.groups[0]!.rejections;

      // The complete-record rule: collapsing is a human-screen concern and `--json` never loses a row.
      assert.deepEqual(
        rejections.map((r) => [r.contractName, r.informative]),
        [
          ["NeverACandidate", false],
          ["ShapedLikeTheBase", true],
          ["WasAMember", true],
        ],
      );
      assert.equal(
        rejections.find((r) => r.contractName === "WasAMember")?.wasMember,
        true,
      );
    });
  });

  describe("When an inspection report is serialized", () => {
    it("should carry contracts, keys, module paths and groups", () => {
      const report = buildInspectionReport(
        {
          MediaStorage: {
            local: {
              exportName: "buildLocalMediaStorage",
              registrationKey: "localMediaStorage",
              modulePath: "src/media/buildLocalMediaStorage.ts",
              relImport: "../media/buildLocalMediaStorage.js",
              contractName: "MediaStorage",
              implementationName: "local",
              lifetime: "singleton",
              moduleIndex: 0,
              default: true,
            },
          },
        },
        {
          groups: {
            mediaStoragesGroup: {
              kind: "collection",
              baseType: "MediaStorage",
              baseTypeId: "id",
              members: [
                {
                  contractName: "MediaStorage",
                  registrationKey: "localMediaStorage",
                },
              ],
            },
          },
        },
      );

      const parsed = JSON.parse(formatInspectionReportJson(report)) as {
        kind: string;
        contracts: {
          implementations: {
            registrationKey: string;
            modulePath: string;
            isDefault: boolean;
          }[];
        }[];
        groups: { groupName: string; rejectionsUnavailable?: boolean }[];
      };

      assert.equal(parsed.kind, "inspect");
      const impl = parsed.contracts[0]!.implementations[0]!;
      assert.equal(impl.registrationKey, "localMediaStorage");
      assert.equal(impl.modulePath, "src/media/buildLocalMediaStorage.ts");
      assert.equal(impl.isDefault, true);
      assert.equal(parsed.groups[0]!.groupName, "mediaStoragesGroup");
      assert.equal(parsed.groups[0]!.rejectionsUnavailable, true);
    });
  });
});

/**
 * Which discovered row, if any, carries the elected default.
 *
 * The join is the registration plan, the same source the row's lifetime comes from. The rule the
 * rows encode is that a default is only worth reporting when there was a field to win: a contract
 * with one implementation elects it by arithmetic, and marking that is what drowns the contract
 * whose default was genuinely contested.
 */
describe("discovery report default election", () => {
  const twoImplFiles: IocDiscoveryAnalysisFiles = [
    {
      modulePath: "src/readers.ts",
      outcomes: [
        {
          scope: "export",
          exportName: "buildGraphReader",
          status: IocDiscoveryStatus.DISCOVERED,
          contractName: "Reader",
          implementationName: "graphReader",
          registrationKey: "graphReader",
          discoveredBy: "naming",
        },
        {
          scope: "export",
          exportName: "buildRestReader",
          status: IocDiscoveryStatus.DISCOVERED,
          contractName: "Reader",
          implementationName: "restReader",
          registrationKey: "restReader",
          discoveredBy: "naming",
        },
      ],
    },
  ];

  const planFor = (
    overrides?: Partial<{ contractDefaultElected: boolean }>,
  ) => [
    {
      contractName: "Reader",
      contractTypeRelImport: "../readers.js",
      contractKey: "reader",
      accessKey: "reader",
      defaultImplementationName: "restReader",
      ...(overrides ?? {}),
      implementations: [
        {
          implementationName: "graphReader",
          registrationKey: "graphReader",
          exportName: "buildGraphReader",
          modulePath: "src/readers.ts",
          relImport: "../readers.js",
          lifetime: "singleton" as const,
        },
        {
          implementationName: "restReader",
          registrationKey: "restReader",
          exportName: "buildRestReader",
          modulePath: "src/readers.ts",
          relImport: "../readers.js",
          lifetime: "singleton" as const,
        },
      ],
    },
  ];

  const rowsOf = (plan: ReturnType<typeof planFor>) =>
    buildDiscoveryReport({
      discoveryFiles: twoImplFiles,
      excludedFiles: [],
      registrationPlan: plan,
    }).files.flatMap((file) => file.rows);

  describe("When a contract has several implementations", () => {
    it("should set isDefault on the elected row only", () => {
      const rows = rowsOf(planFor());

      assert.equal(
        rows.find((r) => r.exportName === "buildRestReader")?.isDefault,
        true,
      );
      assert.equal(
        rows.find((r) => r.exportName === "buildGraphReader")?.isDefault,
        undefined,
      );
    });
  });

  describe("When a group base elected no default of its own", () => {
    it("should mark nobody, since no singular default key is emitted", () => {
      const rows = rowsOf(planFor({ contractDefaultElected: false }));

      assert.deepEqual(
        rows.map((r) => r.isDefault),
        [undefined, undefined],
      );
    });
  });

  describe("When a contract has a single implementation", () => {
    it("should not mark it, because nothing was contested", () => {
      const rows = buildBaseReport().files.flatMap((file) => file.rows);

      assert.equal(
        rows.find((r) => r.exportName === "buildEmailChannel")?.isDefault,
        undefined,
      );
    });
  });
});
