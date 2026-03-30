import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { discoverFactories } from "../generator/discoverFactories/discoverFactories.js";
import {
  buildRegistrationPlan,
  type ResolvedContractRegistration,
} from "../generator/resolveRegistrationPlan.js";
import { analyzeGroupPlan, buildGroupPlan } from "./resolveGroupPlan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "test-fixtures", "base-type-discovery");
const projectRoot = path.resolve(__dirname, "..", "..");
const srcDir = path.join(projectRoot, "src");
const generatedDir = path.join(srcDir, "generated");
const contractsPath = path.join(fixtureDir, "contracts.ts");
const factoriesPath = path.join(fixtureDir, "factories.ts");
const duplicateReadBasePath = path.join(fixtureDir, "duplicate-read-base.ts");

const makeProgram = (): ts.Program =>
  ts.createProgram({
    rootNames: [contractsPath, factoriesPath],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });

const makeProgramWithDuplicateReadService = (): ts.Program =>
  ts.createProgram({
    rootNames: [contractsPath, factoriesPath, duplicateReadBasePath],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });

const runDiscoveryAndPlans = (): ResolvedContractRegistration[] => {
  const program = makeProgram();
  const { contractMap } = discoverFactories(
    [factoriesPath],
    program,
    projectRoot,
    "build",
    { srcDir, generatedDir },
    undefined,
  );
  return buildRegistrationPlan(contractMap, undefined);
};

const discoveryCtx = (program: ts.Program): { program: ts.Program; generatedDir: string } => ({
  program,
  generatedDir,
});

describe("buildGroupPlan", () => {
  describe("When a collection group matches by base type", () => {
    it("should emit an array manifest ordered by registration key", () => {
      const plans = runDiscoveryAndPlans();
      const ctx = discoveryCtx(makeProgram());
      const result = buildGroupPlan(
        {
          readServices: { kind: "collection", baseType: "ReadService" },
        },
        plans,
        ctx,
      );
      assert.ok(result);
      const node = result!.manifest.readServices;
      assert.ok(Array.isArray(node));
      const keys = (node as { registrationKey: string }[]).map((x) => x.registrationKey);
      assert.deepStrictEqual(keys, [
        "albumService",
        "mediaStorage",
        "specialAlbumService",
      ]);
    });
  });

  describe("When an object group matches by base type", () => {
    it("should emit one property per assignable contract keyed by contract key", () => {
      const plans = runDiscoveryAndPlans();
      const ctx = discoveryCtx(makeProgram());
      const result = buildGroupPlan(
        {
          readByKey: { kind: "object", baseType: "ReadService" },
        },
        plans,
        ctx,
      );
      assert.ok(result);
      const node = result!.manifest.readByKey;
      assert.ok(!Array.isArray(node));
      const obj = node as Record<string, { contractName: string; registrationKey: string }>;
      assert.deepStrictEqual(Object.keys(obj).sort(), [
        "albumService",
        "mediaStorage",
        "specialAlbumService",
      ]);
      assert.strictEqual(obj.albumService?.contractName, "AlbumService");
      assert.strictEqual(obj.albumService?.registrationKey, "albumService");
      assert.strictEqual(obj.mediaStorage?.contractName, "MediaStorage");
      assert.strictEqual(obj.mediaStorage?.registrationKey, "mediaStorage");
      assert.strictEqual(obj.specialAlbumService?.contractName, "SpecialAlbumService");
      assert.strictEqual(obj.specialAlbumService?.registrationKey, "specialAlbumService");
    });
  });

  describe("When nothing matches the base type", () => {
    it("should report group_no_matches via analyzeGroupPlan", () => {
      const plans = runDiscoveryAndPlans();
      const ctx = discoveryCtx(makeProgram());
      const analysis = analyzeGroupPlan(
        {
          empty: { kind: "collection", baseType: "NoMatchingContracts" },
        },
        plans,
        ctx,
      );
      assert.strictEqual(analysis.ok, false);
      if (!analysis.ok) {
        assert.strictEqual(analysis.issues[0]?.kind, "group_no_matches");
      }
    });
  });

  describe("When base type is unknown", () => {
    it("should report group_unknown_base_type", () => {
      const plans = runDiscoveryAndPlans();
      const ctx = discoveryCtx(makeProgram());
      const analysis = analyzeGroupPlan(
        {
          bad: { kind: "collection", baseType: "NotInProgramXyz" },
        },
        plans,
        ctx,
      );
      assert.strictEqual(analysis.ok, false);
      if (!analysis.ok) {
        assert.strictEqual(analysis.issues[0]?.kind, "group_unknown_base_type");
      }
    });
  });

  describe("When the base type name is declared in more than one file", () => {
    it("should report group_unknown_base_type with an ambiguous message", () => {
      const plans = runDiscoveryAndPlans();
      const ctx = discoveryCtx(makeProgramWithDuplicateReadService());
      const analysis = analyzeGroupPlan(
        {
          ambiguous: { kind: "collection", baseType: "ReadService" },
        },
        plans,
        ctx,
      );
      assert.strictEqual(analysis.ok, false);
      if (!analysis.ok) {
        const first = analysis.issues[0];
        assert.strictEqual(first?.kind, "group_unknown_base_type");
        if (first?.kind === "group_unknown_base_type") {
          assert.ok(first.message.includes("ambiguous base type"));
        }
      }
    });
  });
});
