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
import { buildManifestArtifactSources } from "../generator/writeManifest.js";
import type { DemandSupplyAnalysisResult } from "../generator/analyzeDemandSupply/index.js";
import type { IocGroupsConfig } from "./resolveGroupPlan.js";
import { analyzeGroupPlan, buildGroupPlan } from "./resolveGroupPlan.js";
import { buildBoundedGroupCollectionTypeRefs } from "./boundedGroupCollectionType.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "test-fixtures", "generic-base");
const projectRoot = path.resolve(__dirname, "..", "..");
const srcDir = path.join(projectRoot, "src");
const generatedDir = path.join(srcDir, "generated");
const contractsPath = path.join(fixtureDir, "contracts.ts");
const factoriesPath = path.join(fixtureDir, "factories.ts");
const scanDirs = [{ absPath: srcDir }];

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

const runDiscoveryAndPlans = (
  program: ts.Program,
): ResolvedContractRegistration[] => {
  const { contractMap } = discoverFactories(
    [factoriesPath],
    program,
    projectRoot,
    "build",
    { projectRoot, scanDirs, generatedDir },
    undefined,
  );
  return buildRegistrationPlan(contractMap, undefined);
};

const discoveryCtx = (
  program: ts.Program,
): { program: ts.Program; generatedDir: string; scanDirs: { absPath: string }[] } => ({
  program,
  generatedDir,
  scanDirs,
});

const emptyDemandSupply: DemandSupplyAnalysisResult = {
  entries: [],
  externalKeys: [],
  scopeProvidedKeys: [],
};

describe("group generic base type-argument gate", () => {
  describe("When a bounded-heterogeneous group declares the constraint", () => {
    it("passes, records member args, and emits ReadonlyArray<Base<declaredArg>>", () => {
      const program = makeProgram();
      const plans = runDiscoveryAndPlans(program);
      const groups: IocGroupsConfig = {
        strategies: {
          kind: "collection",
          baseType: "Strategy",
          baseTypeArg: "SharedEventName",
        },
      };
      const result = buildGroupPlan(groups, plans, discoveryCtx(program));
      assert.ok(result);
      const root = result!.manifest.strategies;
      assert.strictEqual(root.baseTypeArg, "SharedEventName");
      assert.ok(Array.isArray(root.members));
      // Each member records the arg it binds to the base.
      const args = (root.members as { typeArgument?: string }[])
        .map((m) => m.typeArgument)
        .sort();
      assert.deepStrictEqual(args, [
        '"album.shared"',
        '"photo.shared"',
        '"video.shared"',
      ]);

      // The bounded element type resolves to Strategy<...> and imports Strategy.
      const refs = buildBoundedGroupCollectionTypeRefs(result!.manifest, {
        program,
        generatedDir,
        scanDirs,
        projectRoot,
      });
      const elem = refs.get("strategies");
      assert.ok(elem);
      assert.match(elem!.typeName, /^Strategy</);
      assert.ok(elem!.imports.some((i) => i.typeName === "Strategy"));

      // End to end: the cradle collection type is bounded, Strategy is imported.
      const { typesSource } = buildManifestArtifactSources(
        [],
        [],
        result!.manifest,
        path.join(generatedDir, "ioc-manifest.ts"),
        "ioc-manifest",
        { demandSupply: emptyDemandSupply, boundedGroupCollectionTypeRefs: refs },
      );
      assert.match(typesSource, /strategies:\s*ReadonlyArray<Strategy</);
      assert.match(typesSource, /import type \{ Strategy \}/);
    });
  });

  describe("When a homogeneous group declares a literal and a member differs", () => {
    it("fails generation naming the member arg and the declared arg", () => {
      const program = makeProgram();
      const plans = runDiscoveryAndPlans(program);
      const analysis = analyzeGroupPlan(
        {
          strategies: {
            kind: "collection",
            baseType: "Strategy",
            baseTypeArg: "AlbumOnly",
          },
        },
        plans,
        discoveryCtx(program),
      );
      assert.strictEqual(analysis.ok, false);
      if (!analysis.ok) {
        const mismatches = analysis.issues.filter(
          (i) => i.kind === "group_member_arg_not_assignable",
        );
        // PhotoStrategy and VideoStrategy both differ from "album.shared".
        assert.ok(mismatches.length >= 1);
        const first = mismatches[0];
        assert.ok(first?.kind === "group_member_arg_not_assignable");
        if (first.kind === "group_member_arg_not_assignable") {
          assert.match(first.memberArg, /\.shared/);
          assert.strictEqual(first.declaredArg, "AlbumOnly");
        }
      }
    });
  });

  describe("When a non-generic base declares a type argument", () => {
    it("reports group_base_not_generic", () => {
      const program = makeProgram();
      const plans = runDiscoveryAndPlans(program);
      const analysis = analyzeGroupPlan(
        {
          plains: {
            kind: "collection",
            baseType: "Plain",
            baseTypeArg: "SharedEventName",
          },
        },
        plans,
        discoveryCtx(program),
      );
      assert.strictEqual(analysis.ok, false);
      if (!analysis.ok) {
        assert.strictEqual(analysis.issues[0]?.kind, "group_base_not_generic");
      }
    });
  });

  describe("When a generic required-param base omits the type argument", () => {
    it("reports group_generic_base_missing_arg (not bare, not constraint fallback)", () => {
      const program = makeProgram();
      const plans = runDiscoveryAndPlans(program);
      const analysis = analyzeGroupPlan(
        {
          strategies: { kind: "collection", baseType: "Strategy" },
        },
        plans,
        discoveryCtx(program),
      );
      assert.strictEqual(analysis.ok, false);
      if (!analysis.ok) {
        assert.strictEqual(
          analysis.issues[0]?.kind,
          "group_generic_base_missing_arg",
        );
      }
    });
  });

  describe("When two members violate the declared arg", () => {
    it("aggregates both into a single throw", () => {
      const program = makeProgram();
      const plans = runDiscoveryAndPlans(program);
      const analysis = analyzeGroupPlan(
        {
          strategies: {
            kind: "collection",
            baseType: "Strategy",
            baseTypeArg: "AlbumOnly",
          },
        },
        plans,
        discoveryCtx(program),
      );
      assert.strictEqual(analysis.ok, false);
      if (!analysis.ok) {
        const names = analysis.issues
          .filter((i) => i.kind === "group_member_arg_not_assignable")
          .map((i) =>
            i.kind === "group_member_arg_not_assignable" ? i.contractName : "",
          )
          .sort();
        assert.deepStrictEqual(names, ["PhotoStrategy", "VideoStrategy"]);
      }

      // buildGroupPlan throws once with both offenders listed.
      assert.throws(
        () =>
          buildGroupPlan(
            {
              strategies: {
                kind: "collection",
                baseType: "Strategy",
                baseTypeArg: "AlbumOnly",
              },
            },
            plans,
            discoveryCtx(program),
          ),
        (err: Error) =>
          /PhotoStrategy/.test(err.message) &&
          /VideoStrategy/.test(err.message),
      );
    });
  });
});
