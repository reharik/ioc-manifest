/**
 * Contract-slot keys as a member of the STATIC layers.
 *
 * The slot key — a contract's access key, the name its elected default answers to — was registered
 * at runtime (`registerContractDefaultAliases` writes `aliasTo(elected)`) and emitted into the
 * cradle, but the demand/supply pass did not know it existed. A factory that demanded it therefore
 * shadowed the cradle property with a demand entry, was classified external, and appeared in
 * `IocExternals` — asking the composing app to supply a key the package supplies itself.
 *
 * This suite pins all four layers agreeing: emission, supply classification, the scope-root subtree
 * walk, and the absence rules that decide when the key does not exist at all.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import type { IocConfig } from "../config/iocConfig.js";
import { buildGroupPlan } from "../groups/resolveGroupPlan.js";
import { analyzeDemandSupply } from "./analyzeDemandSupply/index.js";
import { contractSlotsForPlans } from "./contractSlotKeys.js";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import { buildRegistrationPlan } from "./resolveRegistrationPlan.js";
import { buildScopeRootOpeners } from "./scopeRootOpeners.js";
import { verifyScopeRoots } from "./verifyScopeRoots.js";
import { buildManifestArtifactSources } from "./writeManifest.js";
import {
  compositionContextFixture,
  parsedSlice,
} from "../test-support/manifestFixtures.js";
import { checkExternalsSatisfaction } from "../composition/checks/externals.js";
import { parseInterfacePropertyNames } from "../composition/parseRegistryInterface.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const fixtureDir = path.join(__dirname, "test-fixtures", "contract-slots");
const generatedDir = path.join(fixtureDir, "generated");
const scanDirs = [{ absPath: fixtureDir }];
const manifestOutPath = path.join(generatedDir, "ioc-manifest.ts");

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
};

/** `ioc.config` electing `optionalAuthMiddleware` — the field's shape, config-elected multi-impl. */
const electOptional = {
  registrations: {
    AuthMiddleware: { optionalAuthMiddleware: { default: true } },
  },
} as unknown as IocConfig;

/**
 * Runs the real pipeline over a fixture set in the order `generateManifest` runs it, up to and
 * including artifact serialization — so what is asserted is what `ioc generate` would write.
 */
const generate = (fileNames: readonly string[], config?: IocConfig) => {
  const files = fileNames.map((name) => path.join(fixtureDir, name));
  const program = ts.createProgram({ rootNames: files, options: compilerOptions });
  const { contractMap, acceptedFactories, scopeRoots } = discoverFactories(
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
  const groupResult = buildGroupPlan(config?.groups, plans, {
    program,
    generatedDir,
    scanDirs,
  });
  const contractSlots = contractSlotsForPlans(plans);
  const demandSupply = analyzeDemandSupply(acceptedFactories, {
    program,
    projectRoot,
    scanDirs,
    generatedDir,
    groupsManifest: groupResult?.manifest,
    scopeRoots,
    contractSlots,
  });
  const verification = verifyScopeRoots(scopeRoots, {
    program,
    projectRoot,
    scanDirs,
    acceptedFactories,
    plans,
    groupsManifest: groupResult?.manifest,
    config,
    externalKeys: demandSupply.externalKeys,
  });
  const scopeRootOpeners = buildScopeRootOpeners(scopeRoots, {
    program,
    projectRoot,
    scanDirs,
    generatedDir,
  });
  const sources = buildManifestArtifactSources(
    [...acceptedFactories],
    plans,
    groupResult?.manifest,
    manifestOutPath,
    "ioc-manifest",
    {
      demandSupply,
      registryTypesBuildContext: {
        program,
        generatedDir,
        scanDirs,
        projectRoot,
      },
      scopeRootOpeners,
    },
  );
  return { plans, contractSlots, demandSupply, verification, sources };
};

const cradleBlockOf = (typesSource: string): string =>
  /export interface IocGeneratedCradle \{[^}]*\}/.exec(typesSource)?.[0] ?? "";

const externalsBlockOf = (typesSource: string): string =>
  /export interface IocExternals \{[^}]*\}/.exec(typesSource)?.[0] ?? "";

const captureWarnings = (fn: () => void): string[] => {
  const warnings: string[] = [];
  const prev = console.warn;
  console.warn = (msg: unknown) => {
    warnings.push(String(msg));
  };
  try {
    fn();
  } finally {
    console.warn = prev;
  }
  return warnings;
};

describe("contract-slot keys", () => {
  describe("When a contract elects a default", () => {
    it("should emit the slot key typed as the contract, by reference", () => {
      const { sources } = generate(
        ["contracts.ts", "auth.ts", "pipeline.ts"],
        electOptional,
      );
      const cradle = cradleBlockOf(sources.typesSource);

      // The slot, typed as the CONTRACT — not as the elected implementation's structural supply
      // type — and reachable through an emitted import rather than an inlined shape.
      assert.match(cradle, /\n {2}authMiddleware: AuthMiddleware;/);
      assert.match(
        sources.typesSource,
        /import type \{[^}]*AuthMiddleware[^}]*\} from "\.\.\/contracts\.js";/s,
      );
      // Both implementation keys stand alongside it, unchanged.
      assert.match(cradle, /\n {2}optionalAuthMiddleware: AuthMiddleware;/);
      assert.match(cradle, /\n {2}strictAuthMiddleware: AuthMiddleware;/);
    });

    it("should satisfy a demand for the slot key locally", () => {
      const { demandSupply, sources } = generate(
        ["contracts.ts", "auth.ts", "pipeline.ts"],
        electOptional,
      );

      const slot = demandSupply.entries.find((e) => e.key === "authMiddleware");
      assert.equal(slot?.classification, "local");
      assert.ok(!demandSupply.externalKeys.includes("authMiddleware"));
      // The line the field reported: `Unsatisfied: authMiddleware`. It came from here.
      assert.equal(externalsBlockOf(sources.typesSource).includes("authMiddleware"), false);
    });

    it("should name the config-elected implementation as the slot's target", () => {
      const { contractSlots } = generate(
        ["contracts.ts", "auth.ts", "pipeline.ts"],
        electOptional,
      );

      assert.deepEqual(
        contractSlots.find((slot) => slot.contractName === "AuthMiddleware"),
        {
          accessKey: "authMiddleware",
          contractName: "AuthMiddleware",
          contractTypeRelImport: "../contracts.js",
          electedRegistrationKey: "optionalAuthMiddleware",
        },
      );
    });

    it("should emit an alias slot even when a factory also demands it", () => {
      // Without the slot key in the supply set the demand entry shadowed the plan's property and
      // the key left the cradle entirely. Both halves are pinned: the property is present, and it
      // carries the contract rather than whatever the demand site happened to write.
      const withDemand = generate(
        ["contracts.ts", "auth.ts", "pipeline.ts"],
        electOptional,
      );
      const withoutDemand = generate(["contracts.ts", "auth.ts"], electOptional);

      assert.match(
        cradleBlockOf(withDemand.sources.typesSource),
        /\n {2}authMiddleware: AuthMiddleware;/,
      );
      assert.match(
        cradleBlockOf(withoutDemand.sources.typesSource),
        /\n {2}authMiddleware: AuthMiddleware;/,
      );
    });
  });

  describe("When another package demands the slot key as an external", () => {
    it("should be satisfied by the emitted cradle at validate time", () => {
      // End to end through the real artifacts: generation writes the slot into
      // `IocGeneratedCradle`, `ioc validate` reads that file as the supply side, and the demanding
      // package's `IocExternals` entry is matched against it. Before the slot key joined the supply
      // set the demanding package's own cradle lost the property AND gained the external, so this
      // comparison had nothing to match on either side of the boundary.
      const { sources } = generate(
        ["contracts.ts", "auth.ts", "pipeline.ts"],
        electOptional,
      );

      const root = mkdtempSync(path.join(tmpdir(), "ioc-slot-validate-"));
      writeFileSync(
        path.join(root, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            target: "ES2022",
            module: "ES2022",
          },
        }),
      );
      const supplierTypesPath = path.join(root, "supplier.types.ts");
      const consumerTypesPath = path.join(root, "consumer.types.ts");
      // The supplier's real generated types, with the fixture-relative contract import rewritten to
      // the copy beside them — nothing else about the file is touched.
      writeFileSync(
        supplierTypesPath,
        sources.typesSource.replace('"../contracts.js"', '"./contracts.js"'),
      );
      writeFileSync(
        path.join(root, "contracts.ts"),
        readFileSync(path.join(fixtureDir, "contracts.ts"), "utf8"),
      );
      writeFileSync(
        consumerTypesPath,
        [
          'import type { AuthMiddleware } from "./contracts.js";',
          "export interface IocGeneratedCradle {}",
          "export interface IocExternals { authMiddleware: AuthMiddleware; }",
        ].join("\n"),
      );

      const cradleKeys = parseInterfacePropertyNames(
        sources.typesSource,
        supplierTypesPath,
        "IocGeneratedCradle",
      );
      assert.ok(cradleKeys.has("authMiddleware"));

      const issues = checkExternalsSatisfaction({
        ...compositionContextFixture([
          parsedSlice({
            packageLabel: "@test/lib-auth",
            sourceId: "@test/lib-auth",
            typesPath: supplierTypesPath,
            cradleKeys: new Set(cradleKeys.keys()),
            cradleTypes: Object.fromEntries(
              [...cradleKeys].map(([key, typeText]) => [key, { typeText }]),
            ),
          }),
          parsedSlice({
            packageLabel: "local",
            typesPath: consumerTypesPath,
            externals: { authMiddleware: { typeText: "AuthMiddleware" } },
          }),
        ]),
        projectRoot: root,
      });

      assert.deepEqual(issues, []);
    });
  });

  describe("When a contract elects no default", () => {
    const groupBaseConfig = {
      groups: {
        strategiesGroup: { kind: "collection", baseType: "Strategy" },
      },
    } as unknown as IocConfig;

    it("should claim no slot key anywhere", () => {
      const { plans, contractSlots, sources } = generate(
        ["contracts.ts", "strategies.ts", "strategy-consumer.ts"],
        groupBaseConfig,
      );

      assert.equal(
        plans.find((p) => p.contractName === "Strategy")?.contractDefaultElected,
        false,
      );
      assert.equal(
        contractSlots.some((slot) => slot.contractName === "Strategy"),
        false,
      );
      assert.equal(
        cradleBlockOf(sources.typesSource).includes("\n  strategy:"),
        false,
      );
    });

    it("should leave a demand for the absent key unsatisfied", () => {
      const { demandSupply, sources } = generate(
        ["contracts.ts", "strategies.ts", "strategy-consumer.ts"],
        groupBaseConfig,
      );

      assert.ok(demandSupply.externalKeys.includes("strategy"));
      assert.match(externalsBlockOf(sources.typesSource), /strategy: Strategy;/);
    });
  });

  describe("When a contract is scope-rooted", () => {
    it("should claim no slot key — opener-only stands", () => {
      const { contractSlots, sources } = generate([
        "contracts.ts",
        "scope-root.ts",
      ]);

      assert.equal(
        contractSlots.some((slot) => slot.contractName === "SlotRouter"),
        false,
      );
      const cradle = cradleBlockOf(sources.typesSource);
      assert.equal(cradle.includes("\n  slotRouter:"), false);
      // Only the opener claims a key for a scope-rooted contract.
      assert.match(cradle, /\n {2}openSlotRouterScope: OpenSlotRouterScope;/);
    });
  });

  describe("When a scope-root subtree crosses a slot-key edge", () => {
    /** The elected middleware is per-scope, so consuming a late-bound value below it is no inversion. */
    const scopedMiddleware = {
      registrations: {
        AuthMiddleware: { taggingAuthMiddleware: { lifetime: "scoped" } },
      },
    } as unknown as IocConfig;

    it("should descend through the election to the implementation", () => {
      const { verification } = generate(
        ["contracts.ts", "scope-root.ts"],
        scopedMiddleware,
      );
      const variant = verification.variants[0]!;

      // The walk reached the elected implementation one level below the slot key…
      assert.ok(
        variant.subtreeUnits.some(
          (unit) => unit.exportName === "buildTaggingAuthMiddleware",
        ),
        "slot-key edge must resolve through the election and descend",
      );
      // …and the path it took names the edge it crossed, registration key by registration key.
      assert.deepEqual(
        variant.scopeDemands.find((demand) => demand.key === "requestTag")
          ?.viaPath,
        ["slotRouter", "taggingAuthMiddleware"],
      );
      // …so `requestTag`, which only that unit demands, is seen as the declared late-bound value it
      // is. With the edge missing the key is invisible and the declaration reads unused.
      assert.deepEqual(variant.declaredKeys, ["requestTag"]);
      assert.deepEqual(variant.unusedDeclaredKeys, []);
      assert.deepEqual(variant.findings, []);
      assert.equal(variant.satisfied, true);
    });
  });

  describe("When a slot key collides with another contract's registration key", () => {
    it("should fail through the existing global key-uniqueness machinery", () => {
      assert.throws(
        () =>
          generate(["contracts.ts", "auth.ts", "divergent.ts"], {
            ...electOptional,
            registrations: {
              ...(electOptional.registrations ?? {}),
              AuditSink: { onlyAuditSink: { name: "authMiddleware" } },
            },
          } as unknown as IocConfig),
        /reserved as the contract default slot for "AuthMiddleware"/,
      );
    });
  });

  describe("When a single-implementation contract's key diverges from its contract key", () => {
    it("should no longer warn — the advisory is retired", () => {
      const warnings = captureWarnings(() => {
        generate(["contracts.ts", "divergent.ts", "divergent-consumer.ts"]);
      });

      assert.deepEqual(
        warnings.filter((w) => w.includes("two cradle names for one thing")),
        [],
      );
    });

    it("should give the two names distinct meanings instead", () => {
      const { sources } = generate([
        "contracts.ts",
        "divergent.ts",
        "divergent-consumer.ts",
      ]);
      const cradle = cradleBlockOf(sources.typesSource);

      // The alias slot, which follows the election…
      assert.match(cradle, /\n {2}auditSink: AuditSink;/);
      // …and the implementation's own key, which does not.
      assert.match(cradle, /\n {2}onlyAuditSink: AuditSink;/);
    });
  });
});
