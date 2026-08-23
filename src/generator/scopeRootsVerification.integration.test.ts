/**
 * Scope-root registration units, stage 2: DEMAND–SUPPLY VERIFICATION.
 *
 * Pins the parts of `docs/design/scope-roots.md`'s stage-2 section that are decidable at generation
 * time: dependency enrichment for scope-root units, the subtree walk, the per-variant satisfaction
 * check in the `supplied extends demanded` direction, the raw-node-in / checker-at-the-boundary
 * discipline for the declared lbv, the lifetime-inversion walk over the subgraph, offender
 * aggregation, and the verification section of `ioc inspect --discovery`.
 *
 * Nothing here emits a builder or a manifest field — scope roots still reach no manifest (stage 3).
 */
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import type { IocConfig } from "../config/iocConfig.js";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import { buildRegistrationPlan } from "./resolveRegistrationPlan.js";
import {
  verifyScopeRootVariant,
  verifyScopeRoots,
  verifyScopeRootsAtCodegen,
  type ScopeRootVerificationContext,
} from "./verifyScopeRoots.js";
import {
  buildDiscoveryReport,
  formatDiscoveryReport,
} from "../inspection/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "test-fixtures", "scope-roots");
const projectRoot = path.resolve(fixtureDir, "../../..");
const srcDir = path.join(projectRoot, "src");
const generatedDir = path.join(srcDir, "generated");
const scanDirs = [{ absPath: srcDir }];

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
};

const fixture = (name: string): string => path.join(fixtureDir, name);

/**
 * Discovers + plans + verifies one fixture set, exactly the way `generateManifest` does, so the
 * assertions below run against the real pipeline rather than a hand-built context.
 */
const verify = (files: string[], config?: IocConfig) => {
  const program = ts.createProgram({ rootNames: files, options: compilerOptions });
  const { contractMap, acceptedFactories, scopeRoots, discoveryFiles } =
    discoverFactories(
      files,
      program,
      projectRoot,
      "build",
      { projectRoot, scanDirs, generatedDir },
      config,
      { collectFileRecords: true },
    );
  const plans = buildRegistrationPlan(contractMap, config, {
    projectRoot,
    scanDirs,
  });
  const ctx: ScopeRootVerificationContext = {
    program,
    projectRoot,
    scanDirs,
    acceptedFactories,
    plans,
    config,
  };
  return {
    ctx,
    scopeRoots,
    acceptedFactories,
    plans,
    discoveryFiles,
    result: verifyScopeRoots(scopeRoots, ctx),
  };
};

/**
 * Real scope-root subtrees are scoped: a singleton that destructures a late-bound value freezes it
 * at first construction. The fixtures say so explicitly so satisfaction and lifetime inversion can
 * be asserted apart from one another.
 */
const scopedSubtree = (
  perContract: Record<
    string,
    Record<
      string,
      {
        lifetime?: "scoped";
        default?: boolean;
        allowLifetimeInversion?: readonly string[];
      }
    >
  >,
  extra?: { scopeProvided?: string[]; groups?: Record<string, unknown> },
): IocConfig =>
  ({ registrations: perContract, ...extra }) as unknown as IocConfig;

const satisfiedFixtures = (): string[] => [
  fixture("deps-contracts.ts"),
  fixture("satisfied.ts"),
];

const satisfiedConfig = scopedSubtree({
  IAuditLog: { auditLog: { lifetime: "scoped" } },
  ISessionStore: { sessionStore: { lifetime: "scoped" } },
});

const directionFixtures = (): string[] => [
  fixture("deps-contracts.ts"),
  fixture("direction.ts"),
];

const directionConfig = scopedSubtree({
  IAuditLog: {
    basicAudit: { lifetime: "scoped", default: true },
    adminAudit: { lifetime: "scoped" },
  },
});

const missingKeyFixtures = (): string[] => [
  fixture("deps-contracts.ts"),
  fixture("missing-key.ts"),
];

/**
 * `viewerId` is declared `scopeProvided`: without that declaration it would classify as an
 * external, and externals are container-supplied rather than scope-demands.
 */
const missingKeyConfig = scopedSubtree(
  { IAuditLog: { auditLog: { lifetime: "scoped" } } },
  { scopeProvided: ["viewerId"] },
);

const externalsFixtures = (): string[] => [
  fixture("deps-contracts.ts"),
  fixture("externals.ts"),
];

const externalsConfig = scopedSubtree(
  {
    IAuditLog: { auditLog: { lifetime: "scoped" } },
    ISessionStore: { sessionStore: { lifetime: "scoped" } },
  },
  { scopeProvided: ["viewerId"] },
);

const rootOwnKeyFixtures = (): string[] => [
  fixture("deps-contracts.ts"),
  fixture("root-own-key.ts"),
];

const groupKeyFixtures = (): string[] => [
  fixture("deps-contracts.ts"),
  fixture("group-key.ts"),
];

const groupKeyConfig = scopedSubtree(
  { IAuditLog: { consoleAudit: { default: true }, fileAudit: {} } },
  { groups: { auditLogsGroup: { kind: "collection", baseType: "IAuditLog" } } },
);

describe("scope-root registration units (stage 2: demand–supply verification)", () => {
  describe("When a scope-root unit is discovered", () => {
    it("should enrich it with the dependency demand set ordinary factories get", () => {
      const { scopeRoots } = verify(satisfiedFixtures(), satisfiedConfig);

      const router = scopeRoots.find(
        (r) => r.exportName === "buildRequestRouter",
      );
      assert.ok(router);
      // Stage 1 deliberately left these unset; stage 2 owns the demand/supply analysis.
      assert.deepStrictEqual(router.dependencyKeys, [
        "auditLog",
        "sessionStore",
      ]);
      assert.deepStrictEqual(router.dependencyContractNames, [
        "IAuditLog",
        "ISessionStore",
      ]);
    });
  });

  describe("When every scope-demand of the subtree is declared", () => {
    it("should report the variant satisfied with no findings", () => {
      const { result } = verify(satisfiedFixtures(), satisfiedConfig);

      assert.strictEqual(result.variants.length, 1);
      const variant = result.variants[0]!;
      assert.strictEqual(variant.variantName, "requestRouter");
      assert.strictEqual(variant.satisfied, true);
      assert.deepStrictEqual(result.errors, []);
      assert.deepStrictEqual(result.warnings, []);
      assert.deepStrictEqual(variant.unusedDeclaredKeys, []);
    });

    it("should collect the scope-demands the walk found, and only those", () => {
      const { result } = verify(satisfiedFixtures(), satisfiedConfig);

      const variant = result.variants[0]!;
      // `auditLog`, `sessionStore` and `clock` are manifest registrations — supplied by the
      // container, so never scope-demands. `viewerId` and `uow` are neither, so they must enter at
      // the boundary. `viewerId` is two levels down: the walk descends, it does not stop at the
      // root's own deps.
      assert.deepStrictEqual(
        variant.scopeDemands.map((d) => d.key),
        ["uow", "viewerId"],
      );
      for (const demand of variant.scopeDemands) {
        assert.strictEqual(demand.satisfiedBy, "declared-lbv");
      }
      const viewerId = variant.scopeDemands.find((d) => d.key === "viewerId")!;
      assert.deepStrictEqual(viewerId.viaPath, ["requestRouter", "auditLog"]);
      assert.deepStrictEqual(viewerId.demandedBy, {
        exportName: "buildAuditLog",
        modulePath: viewerId.demandedBy.modulePath,
      });
      assert.match(viewerId.demandedBy.modulePath, /satisfied\.ts$/);
    });
  });

  describe("When the subtree demands a key the declaration omits", () => {
    it("should error, naming the declaration site and the demanding node", () => {
      const { result } = verify(missingKeyFixtures(), missingKeyConfig);

      const variant = result.variants[0]!;
      assert.strictEqual(variant.satisfied, false);

      const missing = variant.findings.find(
        (f) => f.code === "lbv_missing_key",
      );
      assert.ok(missing);
      assert.strictEqual(missing.severity, "error");
      assert.strictEqual(missing.key, "viewerId");

      // The declaration site: the variant, its export, and what it actually declared.
      assert.match(missing.message, /variant "publicRouter"/);
      assert.match(missing.message, /"buildPublicRouter"/);
      assert.match(missing.message, /declared lbv: \{ publicLinkId: string \}/);
      // The demanding node, and the path the walk took to reach it.
      assert.match(missing.message, /"buildAuditLog"/);
      assert.match(missing.message, /publicRouter → auditLog → viewerId/);
    });

    it("should attribute the demanding node to this app, symmetrically with a composed one", () => {
      const { result } = verify(missingKeyFixtures(), missingKeyConfig);
      const missing = result.variants[0]!.findings.find(
        (f) => f.code === "lbv_missing_key",
      )!;

      // A composed unit prints `(composed package "@x/y")` — the answer to "whose file is this?".
      // A local one used to print nothing at all, which made the composed form read as a special
      // case rather than as one of two answers.
      assert.match(missing.message, /scope-roots\/missing-key\.ts \(this app\)/);
      assert.doesNotMatch(missing.message, /composed package/);
    });

    it("should state that declarations are per-root and complete — declare it here", () => {
      const { result } = verify(missingKeyFixtures(), missingKeyConfig);

      const missing = result.variants[0]!.findings.find(
        (f) => f.code === "lbv_missing_key",
      )!;

      // Written for the developer who knows an outer scope supplies `viewerId` and is about to
      // file this as a tool bug. The rule has to be in the message, not in the docs.
      assert.match(missing.message, /per-root and COMPLETE/);
      assert.match(missing.message, /Declare it here\./);
      assert.match(
        missing.message,
        /including keys an enclosing SCOPE also happens to supply/,
      );
      assert.match(missing.message, /never models scope ancestry/);
      // And it draws the line the boundary ruling draws, so the reader does not conclude that
      // externals or registrations need declaring too.
      assert.match(
        missing.message,
        /Values the root CONTAINER supplies are a different thing/,
      );
      assert.match(
        missing.message,
        /externals are container-supplied and never need declaring/,
      );
    });

    it("should warn about a declared key nothing under the root demands", () => {
      const { result } = verify(missingKeyFixtures(), missingKeyConfig);

      const variant = result.variants[0]!;
      assert.deepStrictEqual(variant.unusedDeclaredKeys, ["publicLinkId"]);

      const unused = variant.findings.find((f) => f.code === "lbv_unused_key");
      assert.ok(unused);
      assert.strictEqual(unused.severity, "warn");
      assert.match(unused.message, /never demanded under the root/);
      // A warning, not an error: the declaration is dead weight, not a broken boundary.
      assert.strictEqual(result.warnings.length, 1);
    });
  });

  describe("When a subtree dependency resolves to an external", () => {
    it("should treat it as container-supplied and not require it in the lbv", () => {
      const { result } = verify(externalsFixtures(), externalsConfig);

      const external = result.variants.find(
        (v) => v.variantName === "externalOnlyRouter",
      )!;

      // `db` is a container constant the app registers on the root container. A scope can be
      // re-mounted under a different parent scope but never transported away from its root
      // container, so nothing about `db` belongs in a boundary declaration.
      assert.strictEqual(external.satisfied, true);
      assert.deepStrictEqual(external.scopeDemands, []);
      assert.deepStrictEqual(external.findings, []);
      assert.strictEqual(external.declaredLbv, "Record<string, never>");
    });

    it("should leave the external's type to the externals check, staying silent itself", () => {
      const { result, acceptedFactories } = verify(
        externalsFixtures(),
        externalsConfig,
      );

      // Scope verification says nothing about `db` — not its presence, not its type.
      for (const variant of result.variants) {
        assert.ok(!variant.findings.some((f) => f.key === "db"));
        assert.ok(!variant.scopeDemands.some((d) => d.key === "db"));
      }

      // It is still demanded, by two different factories with the same declared type. Verifying
      // that type against what the app supplies is the externals-satisfaction check's job at
      // composition, which is a different layer with a different lifecycle.
      const demanders = acceptedFactories
        .filter((f) => (f.dependencyKeys ?? []).includes("db"))
        .map((f) => f.exportName)
        .sort();
      assert.deepStrictEqual(demanders, ["buildAuditLog", "buildSessionStore"]);
      assert.ok(!acceptedFactories.some((f) => f.registrationKey === "db"));
    });

    it("should agree with inspection on SUBTREE-demanded keys", () => {
      // Every demand in this fixture is made by an accepted factory under the root, so the
      // demand/supply pass sees it and classifies it external. Generation reads that set;
      // inspection reaches the same answer by elimination. Where both can see the key, both agree.
      const { ctx, scopeRoots } = verify(externalsFixtures(), externalsConfig);

      const inferred = verifyScopeRoots(scopeRoots, ctx);
      const authoritative = verifyScopeRoots(scopeRoots, {
        ...ctx,
        externalKeys: ["db"],
      });

      assert.deepStrictEqual(
        authoritative.variants.map((v) => [v.variantName, v.satisfied]),
        inferred.variants.map((v) => [v.variantName, v.satisfied]),
      );
      assert.deepStrictEqual(authoritative.errors, inferred.errors);
    });

    it("should simply satisfy a key that is both declared in the lbv and external", () => {
      // The overlap is deliberately not a conflict diagnostic: the declaration wins and the key is
      // verified as a late-bound value, rather than being reported twice or warned as unused.
      const { ctx, scopeRoots } = verify(satisfiedFixtures(), satisfiedConfig);

      const result = verifyScopeRoots(scopeRoots, {
        ...ctx,
        externalKeys: ["viewerId", "uow"],
      });

      const variant = result.variants[0]!;
      assert.strictEqual(variant.satisfied, true);
      assert.deepStrictEqual(
        variant.scopeDemands.map((d) => [d.key, d.satisfiedBy]),
        [
          ["uow", "declared-lbv"],
          ["viewerId", "declared-lbv"],
        ],
      );
      assert.deepStrictEqual(variant.unusedDeclaredKeys, []);
      assert.deepStrictEqual(variant.findings, []);
    });

    it("should still fail on a genuine scope-demand alongside a satisfied external", () => {
      const { result } = verify(externalsFixtures(), externalsConfig);

      const mixed = result.variants.find(
        (v) => v.variantName === "mixedRouter",
      )!;

      assert.strictEqual(mixed.satisfied, false);
      // Exactly one failure, and it is the late-bound value — never the external beside it.
      assert.deepStrictEqual(
        mixed.scopeDemands.map((d) => [d.key, d.satisfiedBy]),
        [["viewerId", "undeclared"]],
      );
      assert.deepStrictEqual(
        mixed.findings
          .filter((f) => f.severity === "error")
          .map((f) => [f.code, f.key]),
        [["lbv_missing_key", "viewerId"]],
      );
    });
  });

  describe("When the scope-root unit itself demands a key nothing declares", () => {
    it("should fail generation with the missing-key error", () => {
      const { ctx, scopeRoots } = verify(rootOwnKeyFixtures());

      // Generation mode: the demand/supply pass ran and found no externals. Empty is not unknown,
      // so `tenantId` cannot be classified external by elimination.
      const result = verifyScopeRoots(scopeRoots, { ...ctx, externalKeys: [] });

      const undeclared = result.variants.find(
        (v) => v.variantName === "undeclaredRootRouter",
      )!;
      assert.strictEqual(undeclared.satisfied, false);
      assert.deepStrictEqual(
        undeclared.scopeDemands.map((d) => [d.key, d.satisfiedBy]),
        [["tenantId", "undeclared"]],
      );
      assert.deepStrictEqual(
        undeclared.findings.map((f) => [f.code, f.key]),
        [["lbv_missing_key", "tenantId"]],
      );
      // The demanding node is the scope root itself — there is no subtree hop.
      assert.deepStrictEqual(undeclared.scopeDemands[0]!.viaPath, [
        "undeclaredRootRouter",
      ]);
      assert.match(
        undeclared.findings[0]!.message,
        /"buildUndeclaredRootRouter"/,
      );
    });

    it("should pass once the variant declares it", () => {
      const { ctx, scopeRoots } = verify(rootOwnKeyFixtures());

      const result = verifyScopeRoots(scopeRoots, { ...ctx, externalKeys: [] });

      const declared = result.variants.find(
        (v) => v.variantName === "declaredRootRouter",
      )!;
      assert.strictEqual(declared.satisfied, true);
      assert.deepStrictEqual(
        declared.scopeDemands.map((d) => [d.key, d.satisfiedBy]),
        [["tenantId", "declared-lbv"]],
      );
      assert.deepStrictEqual(declared.findings, []);
      // Identical demand, identical subtree — only the declaration differs between the two.
      assert.strictEqual(declared.declaredLbv, "{ tenantId: TenantId }");
      assert.strictEqual(result.errors.length, 1);
    });

    it("should read permissively in inspection, an intentional divergence", () => {
      const { ctx, scopeRoots } = verify(rootOwnKeyFixtures());

      // No `externalKeys` threaded: inspection has no demand/supply pass, so `external` is reached
      // by elimination and `tenantId` reads container-supplied. Inspection is a view and must never
      // claim a failure generation does not have; here generation DOES have one, and inspection
      // under-reports it. That is the accepted cost of the permissive stance, pinned here so a
      // future change to either mode is a deliberate one.
      const inspection = verifyScopeRoots(scopeRoots, ctx);
      const generation = verifyScopeRoots(scopeRoots, {
        ...ctx,
        externalKeys: [],
      });

      assert.deepStrictEqual(
        inspection.variants.map((v) => [v.variantName, v.satisfied]),
        [
          ["declaredRootRouter", true],
          ["undeclaredRootRouter", true],
        ],
      );
      assert.deepStrictEqual(
        generation.variants.map((v) => [v.variantName, v.satisfied]),
        [
          ["declaredRootRouter", true],
          ["undeclaredRootRouter", false],
        ],
      );
      assert.deepStrictEqual(inspection.errors, []);
      assert.strictEqual(generation.errors.length, 1);
    });
  });

  describe("When a subtree dependency resolves to a group key", () => {
    it("should report it container-supplied at generation, never unsatisfied", () => {
      // Inspection's shape: no `groupsManifest`, because groups are a codegen artifact.
      const { result } = verify(groupKeyFixtures(), groupKeyConfig);

      const variant = result.variants[0]!;
      assert.strictEqual(variant.variantName, "groupedRouter");

      // The report must never claim unsatisfied for a key generation satisfies.
      assert.strictEqual(variant.satisfied, true);
      assert.deepStrictEqual(variant.scopeDemands, []);
      assert.deepStrictEqual(
        variant.generationResolvedKeys.map((k) => [k.key, k.via]),
        [["auditLogsGroup", "group"]],
      );
      assert.deepStrictEqual(
        variant.generationResolvedKeys[0]!.viaPath,
        ["groupedRouter"],
      );
    });

    it("should render it as container-supplied in the discovery report", () => {
      const { discoveryFiles, scopeRoots, result } = verify(
        groupKeyFixtures(),
        groupKeyConfig,
      );

      const report = buildDiscoveryReport({
        discoveryFiles,
        scopeRoots,
        scopeRootVerification: result,
      });

      const v = report.scopeRoots[0]!.variants[0]!.verification!;
      assert.strictEqual(v.satisfied, true);
      assert.deepStrictEqual(v.generationResolvedKeys, [
        {
          key: "auditLogsGroup",
          via: "group",
          path: "groupedRouter → auditLogsGroup",
        },
      ]);

      const text = formatDiscoveryReport(report, { color: false });
      assert.match(
        text,
        /auditLogsGroup container-supplied — resolved at generation \(group key\)/,
      );
      assert.ok(!text.includes("not declared"));
      assert.match(text, /✔ satisfied/);
    });
  });

  describe("When a declared lbv type does not match the demanded type", () => {
    it("should check supplied extends demanded, and never the inverse", () => {
      const { result } = verify(directionFixtures(), directionConfig);

      const narrow = result.variants.find(
        (v) => v.variantName === "narrowRouter",
      )!;
      const wide = result.variants.find((v) => v.variantName === "wideRouter")!;

      // supplied AdminPrincipal extends demanded Principal — accepted. The inverse direction
      // would reject this, which is exactly what this assertion is here to prevent.
      assert.strictEqual(narrow.satisfied, true);
      assert.deepStrictEqual(
        narrow.scopeDemands.map((d) => [d.key, d.satisfiedBy]),
        [["principal", "declared-lbv"]],
      );

      // supplied Principal does NOT extend demanded AdminPrincipal — rejected. The inverse
      // direction would accept this.
      assert.strictEqual(wide.satisfied, false);
      const mismatch = wide.findings.find(
        (f) => f.code === "lbv_type_mismatch",
      );
      assert.ok(mismatch);
      assert.strictEqual(mismatch.severity, "error");
      assert.strictEqual(mismatch.key, "principal");
      assert.match(mismatch.message, /declared \(supplied\): Principal/);
      assert.match(mismatch.message, /demanded:\s+AdminPrincipal/);
      assert.match(mismatch.message, /supplied extends demanded/);
      assert.deepStrictEqual(
        wide.scopeDemands.map((d) => [d.key, d.satisfiedBy]),
        [["principal", "type-mismatch"]],
      );
    });
  });

  describe("When one root contract has several variants", () => {
    it("should judge each against its own declaration, never a merged lbv set", () => {
      const { result, scopeRoots } = verify(
        directionFixtures(),
        directionConfig,
      );

      // Same root contract, two variants — the variant is the factory identity.
      assert.deepStrictEqual(
        scopeRoots.map((r) => r.contractName),
        ["IRequestRouter", "IRequestRouter"],
      );

      const byVariant = new Map(result.variants.map((v) => [v.variantName, v]));
      assert.strictEqual(byVariant.get("narrowRouter")!.satisfied, true);
      assert.strictEqual(byVariant.get("wideRouter")!.satisfied, false);

      // A union of the two declarations would have supplied `AdminPrincipal` to `wideRouter` and
      // made it pass; an intersection would have made `narrowRouter` fail. Neither happened.
      assert.strictEqual(
        byVariant.get("narrowRouter")!.declaredLbv,
        "{ principal: AdminPrincipal }",
      );
      assert.strictEqual(
        byVariant.get("wideRouter")!.declaredLbv,
        "{ principal: Principal }",
      );
      assert.strictEqual(result.errors.length, 1);
    });

    it("should take the variant as a parameter of the check signature", () => {
      const { ctx, scopeRoots } = verify(directionFixtures(), directionConfig);

      // The per-variant entry point is callable with one variant and nothing else — there is no
      // shape in which the other variants of the contract could participate.
      const wide = scopeRoots.find((r) => r.variantName === "wideRouter")!;
      const alone = verifyScopeRootVariant(wide, ctx);

      assert.strictEqual(alone.variantName, "wideRouter");
      assert.strictEqual(alone.satisfied, false);
      assert.strictEqual(alone.declaredLbv, "{ principal: Principal }");
    });
  });

  describe("When the declared lbv is resolved", () => {
    it("should keep the raw type node on the record and resolve only at the boundary", () => {
      const { ctx, scopeRoots } = verify(satisfiedFixtures(), satisfiedConfig);

      const router = scopeRoots.find(
        (r) => r.variantName === "requestRouter",
      )!;
      const before = router.lbvTypeNode;

      const result = verifyScopeRootVariant(router, ctx);
      assert.strictEqual(result.satisfied, true);

      // The record is still the raw node it was at stage 1: verification resolved a type, used it,
      // and never wrote it back.
      assert.strictEqual(router.lbvTypeNode, before);
      assert.ok(ts.isTypeNode(router.lbvTypeNode));
      assert.ok(ts.isTypeLiteralNode(router.lbvTypeNode));
      assert.strictEqual(
        router.lbvTypeNode.getText(),
        "{ viewerId: ViewerId; uow: UnitOfWork }",
      );
      assert.deepStrictEqual(Object.keys(router).includes("lbvType"), false);

      // The node lives in the program's source files, which is what makes checker resolution at
      // the boundary possible without the record carrying a resolved type.
      const owningFile = router.lbvTypeNode.getSourceFile();
      assert.ok(
        ctx.program.getSourceFiles().includes(owningFile),
        "lbv node must belong to the program the checker came from",
      );

      // Resolved at the boundary, the declared member types are the real ones — the record still
      // reads `ViewerId`, the check reads through to it.
      const checker = ctx.program.getTypeChecker();
      const lbvType = checker.getTypeFromTypeNode(router.lbvTypeNode);
      assert.deepStrictEqual(
        checker
          .getPropertiesOfType(lbvType)
          .map((p) => p.getName())
          .sort(),
        ["uow", "viewerId"],
      );
    });
  });

  describe("When a unit under the root outlives a late-bound value", () => {
    it("should error on a singleton consuming one of the variant's lbv keys", () => {
      // Same fixture, no scoped config: `auditLog` and `sessionStore` default to singleton.
      const { result } = verify(satisfiedFixtures());

      const variant = result.variants[0]!;
      assert.strictEqual(variant.satisfied, false);

      const inversions = variant.findings.filter(
        (f) => f.code === "lifetime_inversion",
      );
      assert.deepStrictEqual(
        inversions.map((f) => f.key).sort(),
        ["uow", "viewerId"],
      );
      for (const inversion of inversions) {
        assert.strictEqual(inversion.severity, "error");
      }

      const viewerIdInversion = inversions.find((f) => f.key === "viewerId")!;
      assert.match(viewerIdInversion.message, /'auditLog' \(singleton/);
      assert.match(
        viewerIdInversion.message,
        /late-bound value of scope root "IRequestRouter" variant "requestRouter", per-scope/,
      );
      assert.match(
        viewerIdInversion.message,
        /freezes its scoped dependency at first construction/,
      );
      // The consumer site carries the same attribution the demand path does.
      assert.match(viewerIdInversion.message, /\.ts \(this app\)\)/);
      // The declaration itself is fine — the failure is the consumer's lifetime, not the lbv set.
      assert.ok(!variant.findings.some((f) => f.code === "lbv_missing_key"));
    });

    it("should not fire when the consumers are scoped", () => {
      const { result } = verify(satisfiedFixtures(), satisfiedConfig);

      assert.ok(
        !result.variants[0]!.findings.some(
          (f) => f.code === "lifetime_inversion",
        ),
      );
    });

    it("should honour allowLifetimeInversion on the consuming implementation", () => {
      const suppressed = {
        registrations: {
          IAuditLog: { auditLog: { allowLifetimeInversion: ["viewerId"] } },
          ISessionStore: { sessionStore: { lifetime: "scoped" } },
        },
      } as unknown as IocConfig;

      const { result } = verify(satisfiedFixtures(), suppressed);

      const inversions = result.variants[0]!.findings.filter(
        (f) => f.code === "lifetime_inversion",
      );
      assert.deepStrictEqual(
        inversions.map((f) => f.key),
        [],
      );
    });
  });

  describe("When several variants fail in one run", () => {
    it("should aggregate every offender into one thrown error", () => {
      const program = ts.createProgram({
        rootNames: [
          fixture("deps-contracts.ts"),
          fixture("direction.ts"),
          fixture("missing-key.ts"),
        ],
        options: compilerOptions,
      });
      const files = [
        fixture("deps-contracts.ts"),
        fixture("direction.ts"),
        fixture("missing-key.ts"),
      ];
      const config = scopedSubtree(
        {
          IAuditLog: {
            basicAudit: { lifetime: "scoped", default: true },
            adminAudit: { lifetime: "scoped" },
            auditLog: { lifetime: "scoped" },
          },
        },
        { scopeProvided: ["viewerId"] },
      );
      const { contractMap, acceptedFactories, scopeRoots } = discoverFactories(
        files,
        program,
        projectRoot,
        "build",
        { projectRoot, scanDirs, generatedDir },
        config,
      );
      const plans = buildRegistrationPlan(contractMap, config, {
        projectRoot,
        scanDirs,
      });
      const ctx: ScopeRootVerificationContext = {
        program,
        projectRoot,
        scanDirs,
        acceptedFactories,
        plans,
        config,
      };

      assert.throws(
        () => verifyScopeRootsAtCodegen(scopeRoots, ctx),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          // One error carrying every offender — the discovery offender-bucket shape, so a single
          // run surfaces both failures instead of the first one.
          assert.match(message, /2 scope-root verification failure\(s\)/);
          assert.match(message, /variant "wideRouter"/);
          assert.match(message, /variant "publicRouter"/);
          assert.match(message, /"viewerId"/);
          assert.match(message, /principal/);
          return true;
        },
      );
    });

    it("should return the offenders instead of throwing under tolerateInvalidAnnotations", () => {
      const { ctx, scopeRoots } = verify(missingKeyFixtures(), missingKeyConfig);

      const result = verifyScopeRootsAtCodegen(scopeRoots, ctx, {
        tolerateInvalidAnnotations: true,
      });

      assert.strictEqual(result.errors.length, 1);
      assert.strictEqual(result.variants[0]!.satisfied, false);
    });

    it("should be a no-op when no scope roots were discovered", () => {
      const { result } = verify([fixture("deps-contracts.ts")]);

      assert.deepStrictEqual(result, {
        variants: [],
        errors: [],
        warnings: [],
      });
    });
  });

  describe("When the discovery report is built (ioc inspect --discovery)", () => {
    it("should carry per-variant verification results into the scope-roots section", () => {
      const { discoveryFiles, scopeRoots, result } = verify(
        directionFixtures(),
        directionConfig,
      );

      const report = buildDiscoveryReport({
        discoveryFiles,
        scopeRoots,
        scopeRootVerification: result,
      });

      assert.strictEqual(report.scopeRoots.length, 1);
      const root = report.scopeRoots[0]!;
      const byVariant = new Map(root.variants.map((v) => [v.variantName, v]));

      const narrow = byVariant.get("narrowRouter")!.verification;
      assert.ok(narrow);
      assert.strictEqual(narrow.satisfied, true);
      assert.deepStrictEqual(narrow.scopeDemands, [
        {
          key: "principal",
          satisfiedBy: "declared-lbv",
          via: "narrowRouter → basicAudit → principal",
          demandedTypeText: "Principal",
          suppliedTypeText: "AdminPrincipal",
        },
      ]);

      const wide = byVariant.get("wideRouter")!.verification;
      assert.ok(wide);
      assert.strictEqual(wide.satisfied, false);
      assert.strictEqual(wide.scopeDemands[0]!.satisfiedBy, "type-mismatch");
      assert.strictEqual(wide.findings[0]!.code, "lbv_type_mismatch");

      const text = formatDiscoveryReport(report, { color: false });
      assert.match(text, /✔ satisfied/);
      assert.match(text, /✖ unsatisfied/);
      // A satisfied variant's demands stay off the screen; the unsatisfied one lists its own,
      // walk path included.
      assert.ok(!text.includes("(narrowRouter → basicAudit → principal)"));
      assert.match(
        text,
        /principal declared Principal is not assignable to demanded AdminPrincipal \(wideRouter → adminAudit → principal\)/,
      );
    });

    it("should render the missing-key and unused-key rows", () => {
      const { discoveryFiles, scopeRoots, result } = verify(
        missingKeyFixtures(),
        missingKeyConfig,
      );

      const text = formatDiscoveryReport(
        buildDiscoveryReport({
          discoveryFiles,
          scopeRoots,
          scopeRootVerification: result,
        }),
        { color: false },
      );

      assert.match(text, /viewerId not declared/);
      assert.match(text, /publicLinkId declared but never demanded/);
    });

    it("should omit the verification block when the caller supplied no stage-2 results", () => {
      const { discoveryFiles, scopeRoots } = verify(
        satisfiedFixtures(),
        satisfiedConfig,
      );

      const report = buildDiscoveryReport({ discoveryFiles, scopeRoots });

      assert.strictEqual(
        report.scopeRoots[0]!.variants[0]!.verification,
        undefined,
      );
      assert.match(
        formatDiscoveryReport(report, { color: false }),
        /\[scope root\].*unverified/,
      );
    });
  });

  describe("When stage-2 verification finishes", () => {
    it("should still keep scope roots out of the contract map and the plan", () => {
      const { contractMapContracts, plans } = (() => {
        const { plans: p, ctx } = verify(satisfiedFixtures(), satisfiedConfig);
        void ctx;
        return {
          contractMapContracts: p.map((c) => c.contractName).sort(),
          plans: p,
        };
      })();

      // Verification is a check, not an emission: the root contract still claims no cradle key.
      assert.ok(!contractMapContracts.includes("IRequestRouter"));
      assert.deepStrictEqual(contractMapContracts, [
        "IAuditLog",
        "IClock",
        "ISessionStore",
      ]);
      assert.ok(
        !plans.some((p) =>
          p.implementations.some((i) => i.exportName === "buildRequestRouter"),
        ),
      );
    });
  });
});
