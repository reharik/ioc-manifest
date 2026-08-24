/**
 * `ioc explain <key>` — the join around one key.
 *
 * The scenario is the field's own: a write service whose lifetime it does not declare (the group's
 * base does), pulled into a request scope, depended on through a group root. That shape is what the
 * command exists for, and every section of the report is asserted against it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { explainFromDiscovery, explainFromManifest } from "./explain.js";
import {
  formatExplainReport,
  formatExplainReportJson,
} from "./formatExplain.js";
import type { DiscoveryAnalysisResult } from "./runDiscoveryAnalysis.js";

const ESC = "\u001b";

type Impl = {
  implementationName: string;
  registrationKey: string;
  lifetime: "singleton" | "scoped" | "transient";
  lifetimeSource?: string;
  dependencyKeys?: readonly string[];
};

const upperFirst = (s: string): string =>
  `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

const plan = (
  contractName: string,
  accessKey: string,
  implementations: readonly Impl[],
  extra?: { grouped?: boolean },
) => ({
  contractName,
  contractTypeRelImport: `../types/${contractName}.js`,
  contractKey: accessKey,
  accessKey,
  defaultImplementationName: implementations[0]!.implementationName,
  ...(extra?.grouped === true
    ? { contractDefaultElected: false, grouped: true as const }
    : {}),
  implementations: implementations.map((impl) => ({
    implementationName: impl.implementationName,
    registrationKey: impl.registrationKey,
    exportName: `build${upperFirst(impl.implementationName)}`,
    modulePath: `src/factories/build${upperFirst(impl.implementationName)}.ts`,
    relImport: "../x.js",
    lifetime: impl.lifetime,
    ...(impl.lifetimeSource !== undefined
      ? { lifetimeSource: impl.lifetimeSource }
      : {}),
    ...(impl.dependencyKeys !== undefined
      ? { dependencyKeys: impl.dependencyKeys }
      : {}),
  })),
});

const analysis = (
  overrides: Partial<DiscoveryAnalysisResult>,
): DiscoveryAnalysisResult =>
  ({
    discoveryFiles: [],
    contractMap: new Map(),
    acceptedFactories: [],
    scopeRoots: [],
    registrationPlan: [],
    scopeRootVerification: { variants: [], errors: [], warnings: [] },
    scopeRootSharedUnits: [],
    groupPlans: [],
    lifetimeMarkerMatches: new Map(),
    excludedFiles: [],
    ...overrides,
  }) as DiscoveryAnalysisResult;

/**
 * A grouped write service, its per-request unit of work, a transient id generator it holds, a
 * singleton that reaches it through the group root, and a scope root whose subtree covers it.
 */
const fieldScenario = (): DiscoveryAnalysisResult =>
  analysis({
    registrationPlan: [
      plan(
        "OrderWriteService",
        "orderWriteService",
        [
          {
            implementationName: "orderWriteService",
            registrationKey: "orderWriteService",
            lifetime: "scoped",
            lifetimeSource: "group-base-marker",
            dependencyKeys: ["uow", "idGenerator"],
          },
        ],
        { grouped: true },
      ),
      plan("UnitOfWork", "uow", [
        {
          implementationName: "uow",
          registrationKey: "uow",
          lifetime: "scoped",
          lifetimeSource: "lifetime-marker",
        },
      ]),
      plan("IdGenerator", "idGenerator", [
        {
          implementationName: "idGenerator",
          registrationKey: "idGenerator",
          lifetime: "transient",
          lifetimeSource: "factory-config",
        },
      ]),
      plan("AuditRunner", "auditRunner", [
        {
          implementationName: "auditRunner",
          registrationKey: "auditRunner",
          lifetime: "singleton",
          lifetimeSource: "default",
          dependencyKeys: ["writeServices"],
        },
      ]),
    ],
    groupPlans: [
      {
        groupName: "writeServices",
        kind: "collection",
        baseType: "WriteServiceBase",
        baseTypeId: "id",
        members: [
          {
            contractName: "OrderWriteService",
            registrationKey: "orderWriteService",
          },
        ],
        rejections: [],
      },
    ],
    lifetimeMarkerMatches: new Map([
      [
        "src/factories/buildOrderWriteService.ts:buildOrderWriteService",
        { name: "RequestScopeLifeCycle", lifetime: "scoped" as const },
      ],
    ]),
    scopeRootVerification: {
      variants: [
        {
          contractName: "IRouter",
          variantName: "authRouter",
          exportName: "buildAuthRouter",
          modulePath: "src/factories/buildAuthRouter.ts",
          declaredLbv: "{ uow: UnitOfWork }",
          declaredKeys: ["uow"],
          subtreeUnits: [
            {
              exportName: "buildAuthRouter",
              modulePath: "src/factories/buildAuthRouter.ts",
            },
            {
              exportName: "buildOrderWriteService",
              modulePath: "src/factories/buildOrderWriteService.ts",
              registrationKey: "orderWriteService",
            },
          ],
          scopeDemands: [],
          generationResolvedKeys: [],
          unusedDeclaredKeys: [],
          blindComposedPackages: [],
          findings: [],
          satisfied: true,
        },
      ],
      errors: [],
      warnings: [],
    },
  });

describe("explainFromDiscovery", () => {
  describe("When the key is a grouped registration whose lifetime came from the group base", () => {
    const report = explainFromDiscovery("orderWriteService", fieldScenario());

    it("should resolve the key to its registration", () => {
      assert.equal(report.resolution.kind, "registration");
      assert.equal(
        report.resolution.kind === "registration"
          ? report.resolution.unit.contractName
          : undefined,
        "OrderWriteService",
      );
    });

    it("should trace the lifetime back to the marker on the group's base", () => {
      assert.equal(report.lifetime?.lifetime, "scoped");
      assert.deepEqual(report.lifetime?.provenance, [
        "group-base marker on WriteServiceBase (RequestScopeLifeCycle)",
        'member of group "writeServices"',
      ]);
    });

    it("should resolve each dependency and flag floor-rule pressure", () => {
      assert.deepEqual(
        report.dependencies.map((d) => [
          d.key,
          d.lifetime,
          d.pressure?.severity,
        ]),
        [
          ["uow", "scoped", undefined],
          // A scoped consumer holding a transient: real, advisory, and the same severity codegen
          // assigns to the same edge.
          ["idGenerator", "transient", "warn"],
        ],
      );
    });

    it("should find dependents reached through the group root", () => {
      assert.deepEqual(report.dependents, [
        {
          demander: "auditRunner",
          modulePath: "src/factories/buildAuditRunner.ts",
          via: "group:writeServices",
        },
      ]);
    });

    it("should name the scope-root subtrees that reach it", () => {
      assert.deepEqual(report.scopeRootSubtrees, [
        {
          contractName: "IRouter",
          variantName: "authRouter",
          openerKey: "openAuthRouterScope",
        },
      ]);
    });

    it("should render one screen carrying all four answers", () => {
      const text = formatExplainReport(report, { color: false });

      assert.match(
        text,
        /^orderWriteService → registration of OrderWriteService/m,
      );
      assert.match(
        text,
        /Lifetime: scoped ← group-base marker on WriteServiceBase \(RequestScopeLifeCycle\) ← member of group "writeServices"/,
      );
      assert.match(text, /idGenerator\s+transient/);
      assert.match(text, /!\[lifetime-inversion\]/);
      assert.match(text, /→ docs: https:\/\/.*concepts\/lifetimes#/);
      assert.match(text, /auditRunner .*via group:writeServices/);
      assert.match(text, /⬢ IRouter variant: authRouter/);
    });

    it("should carry the same record as JSON, with no colour", () => {
      const json = formatExplainReportJson(report);
      const parsed = JSON.parse(json) as {
        kind: string;
        mode: string;
        dependencies: { key: string }[];
      };

      assert.equal(parsed.kind, "explain");
      assert.equal(parsed.mode, "discovery");
      assert.deepEqual(
        parsed.dependencies.map((d) => d.key),
        ["uow", "idGenerator"],
      );
      assert.ok(!json.includes(ESC));
      assert.ok(formatExplainReport(report, { color: true }).includes(ESC));
    });
  });

  describe("When the key is a group root", () => {
    it("should list its members rather than a lifetime it does not have", () => {
      const report = explainFromDiscovery("writeServices", fieldScenario());

      assert.equal(report.resolution.kind, "group");
      assert.equal(report.lifetime, undefined);
      assert.deepEqual(
        report.resolution.kind === "group"
          ? report.resolution.members.map((m) => m.registrationKey)
          : [],
        ["orderWriteService"],
      );
      assert.deepEqual(
        report.dependents.map((d) => d.demander),
        ["auditRunner"],
      );
    });
  });

  describe("When the key is nothing this package registers", () => {
    it("should say so and offer the keys that look like it", () => {
      const report = explainFromDiscovery("orderWriteServic", fieldScenario());

      assert.equal(report.resolution.kind, "unknown");
      assert.deepEqual(
        report.resolution.kind === "unknown"
          ? report.resolution.similarKeys
          : [],
        ["orderWriteService"],
      );

      // "Demanded by nothing" is not a second finding for a key that resolves to nothing — it is
      // the same one restated, so the section stays off.
      const text = formatExplainReport(report, { color: false });
      assert.ok(!/Demanded by/.test(text));
    });
  });
});

describe("explainFromManifest", () => {
  const manifest = {
    contracts: {
      Storage: {
        s3Storage: {
          exportName: "buildS3Storage",
          registrationKey: "s3Storage",
          modulePath: "src/factories/buildS3Storage.ts",
          relImport: "../x.js",
          contractName: "Storage",
          implementationName: "s3Storage",
          lifetime: "singleton" as const,
          moduleIndex: 0,
          default: true,
          dependencyKeys: ["uow"],
        },
      },
      UnitOfWork: {
        uow: {
          exportName: "buildUow",
          registrationKey: "uow",
          modulePath: "src/factories/buildUow.ts",
          relImport: "../y.js",
          contractName: "UnitOfWork",
          implementationName: "uow",
          lifetime: "scoped" as const,
          moduleIndex: 1,
        },
      },
    },
    groups: {},
    scopeRoots: undefined,
  };

  describe("When the manifest is the only source", () => {
    const report = explainFromManifest("s3Storage", manifest);

    it("should still resolve the key, its dependencies and the floor-rule pressure", () => {
      assert.equal(report.resolution.kind, "registration");
      assert.equal(report.lifetime?.lifetime, "singleton");
      assert.deepEqual(
        report.dependencies.map((d) => [
          d.key,
          d.lifetime,
          d.pressure?.severity,
        ]),
        // The captive dependency, seen from the manifest alone: a singleton holding the per-request
        // unit of work is the incident this whole family of checks came from.
        [["uow", "scoped", "error"]],
      );
    });

    it("should say what a manifest cannot know instead of inventing it", () => {
      assert.deepEqual(report.lifetime?.provenance, []);
      assert.deepEqual(report.scopeRootSubtrees, []);
      assert.match(report.notes.join(" "), /run `ioc explain <key> --discovery`/);

      const text = formatExplainReport(report, { color: false });
      assert.match(text, /provenance not recorded in the manifest/);
    });
  });

  describe("When the key is the contract slot rather than the registration", () => {
    it("should explain the elected implementation behind the slot", () => {
      const report = explainFromManifest("storage", manifest);

      assert.equal(report.resolution.kind, "contract-slot");
      assert.equal(
        report.resolution.kind === "contract-slot"
          ? report.resolution.electee?.registrationKey
          : undefined,
        "s3Storage",
      );
      assert.equal(report.lifetime?.lifetime, "singleton");
    });
  });

  /**
   * The no-regression pin.
   *
   * A library composes nothing, so there is no composed picture to answer over and every one of the
   * cross-package facilities must be invisible: no supplier line, no caveat, and the manifest-mode
   * note in the words it has always used. Pinned as one exact screen rather than as assertions
   * about parts, because "byte-identical" is the claim.
   */
  describe("When the package composes nothing", () => {
    it("should print exactly the screen it has always printed", () => {
      assert.equal(
        formatExplainReport(explainFromManifest("s3Storage", manifest), {
          color: false,
        }),
        [
          "s3Storage → registration of Storage (s3Storage)  ★ backs the contract slot",
          "  declared in src/factories/buildS3Storage.ts#buildS3Storage",
          "",
          "Lifetime: singleton ← provenance not recorded in the manifest",
          "",
          "Depends on:",
          "  uow  scoped  registration of UnitOfWork",
          "      ![lifetime-inversion] a singleton freezes its scoped dependency at first construction and reuses it across every scope",
          "      → docs: https://reharik.github.io/ioc-manifest/concepts/lifetimes#the-floor-rule",
          "",
          "Demanded by: nothing in this package",
          "",
          "Read from the generated manifest. A manifest records the lifetime it resolved, not the marker or config that decided it, and it records no scope-root subtree — run `ioc explain <key> --discovery` for provenance and subtree reach.",
        ].join("\n"),
      );
    });
  });

  /**
   * Provenance from a manifest, which used to be the command's stated blind spot.
   *
   * The chain is thinner than discovery's — the marker's NAME is a fact about sources this mode
   * never read — but which mechanism decided the lifetime, and which group or config entry it
   * points at, are now recorded and rendered. The note drops its provenance clause with them: a
   * manifest that carries the field must not go on disclaiming it.
   */
  describe("When the manifest records lifetime provenance", () => {
    const withProvenance = {
      contracts: {
        UnitOfWork: {
          uow: {
            ...manifest.contracts.UnitOfWork.uow,
            lifetimeSource: "lifetime-marker" as const,
          },
        },
      },
      groups: {},
      scopeRoots: undefined,
      declaredFeatures: ["dependencyKeys", "lifetimeSource"],
    };

    it("should render the chain and stop disclaiming what it now knows", () => {
      const report = explainFromManifest("uow", withProvenance);

      assert.deepEqual(report.lifetime?.provenance, [
        "lifetime-marker",
        "on the contract site of buildUow",
      ]);
      const text = formatExplainReport(report, { color: false });
      assert.match(text, /Lifetime: scoped ← lifetime-marker ← on the contract site of buildUow/);
      assert.ok(!/provenance not recorded/.test(text));
      assert.ok(!/not the marker or config that decided it/.test(text));
      assert.match(report.notes.join(" "), /records no scope-root subtree/);
    });
  });
});
