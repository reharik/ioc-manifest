import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { discoverFactories } from "../generator/discoverFactories/discoverFactories.js";
import { buildRegistrationPlan } from "../generator/resolveRegistrationPlan.js";
import { buildGroupPlan } from "./resolveGroupPlan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "test-fixtures", "nominal-group");
const projectRoot = path.resolve(__dirname, "..", "..");
const srcDir = path.join(projectRoot, "src");
const generatedDir = path.join(srcDir, "generated");
const contractsPath = path.join(fixtureDir, "contracts.ts");
const factoriesPath = path.join(fixtureDir, "factories.ts");

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

describe("nominal group membership", () => {
  describe("When the group base type is an empty interface", () => {
    it("should include only contracts that declare extends on the base type", () => {
      const program = makeProgram();
      const { contractMap } = discoverFactories(
        [factoriesPath],
        program,
        projectRoot,
        "build",
        { projectRoot, scanDirs: [{ absPath: srcDir }], generatedDir },
        undefined,
      );
      const plans = buildRegistrationPlan(contractMap, undefined);
      const result = buildGroupPlan(
        { grouped: { kind: "collection", baseType: "BaseA" } },
        plans,
        { program, generatedDir, scanDirs: [{ absPath: srcDir }] },
      );
      assert.ok(result);
      const root = result!.manifest.grouped;
      assert.ok(Array.isArray(root.members));
      const keys = root.members.map((member) => member.registrationKey).sort();
      assert.deepStrictEqual(keys, ["inGroupA", "inGroupB"]);
    });
  });
});
