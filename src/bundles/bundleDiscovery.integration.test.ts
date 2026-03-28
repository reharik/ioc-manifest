import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { loadIocConfig } from "../config/loadIocConfig.js";
import { discoverFactories } from "../generator/discoverFactories/discoverFactories.js";
import { buildRegistrationPlan } from "../generator/resolveRegistrationPlan.js";
import {
  analyzeBundlePlan,
  buildBundlePlan,
} from "./resolveBundlePlan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "test-fixtures", "bundle-discovery");
const projectRoot = path.resolve(__dirname, "..", "..");
const srcDir = path.join(projectRoot, "src");
const generatedDir = path.join(srcDir, "generated");
const injectablePath = path.join(srcDir, "core", "injectable.ts");
const contractsPath = path.join(fixtureDir, "contracts.ts");
const factoriesPath = path.join(fixtureDir, "factories.ts");
const duplicateReadBasePath = path.join(fixtureDir, "duplicate-read-base.ts");

const makeProgram = (): ts.Program =>
  ts.createProgram({
    rootNames: [contractsPath, factoriesPath, injectablePath],
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
    rootNames: [contractsPath, factoriesPath, injectablePath, duplicateReadBasePath],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });

const runDiscoveryAndPlans = (): ReturnType<typeof buildRegistrationPlan> => {
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

describe("bundle discovery by base interface", () => {
  describe("When resolving plans with $discover", () => {
    it("should match contracts whose interface types are assignable to the base (direct and indirect)", () => {
      const plans = runDiscoveryAndPlans();
      const program = makeProgram();
      const resolved = buildBundlePlan(
        {
          services: {
            read: { $discover: { baseInterface: "ReadService" } },
          },
        },
        plans,
        { program, generatedDir },
      );
      assert.ok(resolved);
      const read = (resolved.tree.services as { read: unknown }).read as {
        contractName: string;
      }[];
      const names = read.map((x) => x.contractName).sort((a, b) =>
        a.localeCompare(b),
      );
      assert.deepStrictEqual(names, [
        "AlbumService",
        "MediaStorage",
        "SpecialAlbumService",
      ]);
    });

    it("should accept shorthand $discover string", () => {
      const plans = runDiscoveryAndPlans();
      const program = makeProgram();
      const resolved = buildBundlePlan(
        {
          services: {
            read: { $discover: "ReadService" },
          },
        },
        plans,
        { program, generatedDir },
      );
      assert.ok(resolved);
      const read = (resolved.tree.services as { read: unknown }).read as {
        contractName: string;
      }[];
      assert.strictEqual(read.length, 3);
    });

    it("should produce an empty leaf when nothing matches the base interface", () => {
      const plans = runDiscoveryAndPlans();
      const program = makeProgram();
      const resolved = buildBundlePlan(
        {
          services: {
            empty: { $discover: { baseInterface: "NoMatchingContracts" } },
          },
        },
        plans,
        { program, generatedDir },
      );
      assert.ok(resolved);
      const empty = (resolved.tree.services as { empty: unknown }).empty as unknown[];
      assert.deepStrictEqual(empty, []);
    });

    it("should sort discovered contracts by contract name", () => {
      const plans = runDiscoveryAndPlans();
      const program = makeProgram();
      const resolved = buildBundlePlan(
        {
          services: {
            read: { $discover: { baseInterface: "ReadService" } },
          },
        },
        plans,
        { program, generatedDir },
      );
      assert.ok(resolved);
      const read = (resolved.tree.services as { read: unknown }).read as {
        contractName: string;
      }[];
      const names = read.map((r) => r.contractName);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      assert.deepStrictEqual(names, sorted);
    });

    it("should dedupe the same contract from explicit entries and bundle refs after discovery", () => {
      const plans = runDiscoveryAndPlans();
      const program = makeProgram();
      const resolved = buildBundlePlan(
        {
          services: {
            read: { $discover: { baseInterface: "ReadService" } },
            combined: [
              "MediaStorage",
              { $bundleRef: "services.read" },
            ],
          },
        },
        plans,
        { program, generatedDir },
      );
      assert.ok(resolved);
      const combined = (resolved.tree.services as { combined: unknown })
        .combined as { contractName: string }[];
      const names = combined.map((c) => c.contractName);
      assert.deepStrictEqual(names, [
        "MediaStorage",
        "AlbumService",
        "SpecialAlbumService",
      ]);
    });

    it("should surface unknown base interface names", () => {
      const plans = runDiscoveryAndPlans();
      const program = makeProgram();
      assert.throws(
        () =>
          buildBundlePlan(
            {
              services: {
                bad: { $discover: { baseInterface: "NotARealType" } },
              },
            },
            plans,
            { program, generatedDir },
          ),
        /no interface or type alias named "NotARealType"/,
      );
    });

    it("should reject ambiguous base interface names declared in more than one source file", () => {
      const plans = runDiscoveryAndPlans();
      const program = makeProgramWithDuplicateReadService();
      assert.throws(
        () =>
          buildBundlePlan(
            {
              services: {
                bad: { $discover: { baseInterface: "ReadService" } },
              },
            },
            plans,
            { program, generatedDir },
          ),
        /ambiguous base interface "ReadService"/,
      );
    });

    it("should require compiler context when config uses $discover", () => {
      const plans = runDiscoveryAndPlans();
      assert.throws(
        () =>
          buildBundlePlan(
            {
              services: {
                read: { $discover: { baseInterface: "ReadService" } },
              },
            },
            plans,
          ),
        /without a TypeScript program/,
      );
    });

    it("should report analyzeBundlePlan issues when discovery context is missing", () => {
      const plans = runDiscoveryAndPlans();
      const analysis = analyzeBundlePlan(
        {
          services: {
            read: { $discover: { baseInterface: "ReadService" } },
          },
        },
        plans,
      );
      assert.strictEqual(analysis.ok, false);
      if (!analysis.ok) {
        assert.ok(
          analysis.issues.some((i) => i.kind === "bundle_discovery_missing_context"),
        );
      }
    });
  });

  describe("When loadIocConfig validates bundles", () => {
    it("should reject invalid $discover object shapes", async () => {
      const configPath = path.join(fixtureDir, "invalid-discover.config.ts");
      await assert.rejects(
        () => loadIocConfig(configPath),
        /\$discover must be a non-empty string or exactly/,
      );
    });

    it("should reject $discover mixed with sibling keys", async () => {
      const configPath = path.join(fixtureDir, "mixed-discover.config.ts");
      await assert.rejects(
        () => loadIocConfig(configPath),
        /cannot mix "\$discover"/,
      );
    });
  });
});

describe("generated bundle typing with discovery", () => {
  describe("When cradle types are derived from the resolved plan", () => {
    it("should use concrete contract names in the union, not the base interface name", () => {
      const plans = runDiscoveryAndPlans();
      const program = makeProgram();
      const resolved = buildBundlePlan(
        {
          services: {
            read: { $discover: { baseInterface: "ReadService" } },
          },
        },
        plans,
        { program, generatedDir },
      );
      assert.ok(resolved);
      const read = (resolved.tree.services as { read: unknown }).read as {
        contractName: string;
      }[];
      const union = read.map((r) => r.contractName).join(" | ");
      assert.match(union, /AlbumService/);
      assert.match(union, /MediaStorage/);
      assert.ok(!union.includes("ReadService"));
    });

    it("should expose resolved leaves compatible with IocBundlesManifest runtime shape", () => {
      const plans = runDiscoveryAndPlans();
      const program = makeProgram();
      const resolved = buildBundlePlan(
        {
          services: {
            read: { $discover: { baseInterface: "ReadService" } },
          },
        },
        plans,
        { program, generatedDir },
      );
      assert.ok(resolved);
      const read = (resolved.tree.services as { read: unknown }).read as unknown[];
      assert.ok(Array.isArray(read));
      for (const leaf of read) {
        assert.ok(
          typeof leaf === "object" &&
            leaf !== null &&
            "contractName" in leaf &&
            "registrationKey" in leaf,
        );
      }
    });
  });
});
