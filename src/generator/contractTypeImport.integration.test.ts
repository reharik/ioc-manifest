import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import type { IocConfig } from "../config/iocConfig.js";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import { buildRegistrationPlan } from "./resolveRegistrationPlan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "test-fixtures/contract-type-import");
const projectRoot = path.resolve(fixtureDir, "../../../..");
const srcDir = path.join(projectRoot, "src");
const generatedDir = path.join(srcDir, "generated");

const makeProgram = (): ts.Program => {
  const roots = [
    path.join(fixtureDir, "contract.ts"),
    path.join(fixtureDir, "implA.ts"),
    path.join(fixtureDir, "implB.ts"),
  ];
  return ts.createProgram({
    rootNames: roots,
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });
};

describe("Contract type import source (discovery)", () => {
  describe("When the configured default implementation changes", () => {
    it("should keep the same contractTypeRelImport on the registration plan", () => {
      const program = makeProgram();
      const implA = path.join(fixtureDir, "implA.ts");
      const implB = path.join(fixtureDir, "implB.ts");
      const { contractMap } = discoverFactories([implA, implB], program, projectRoot, "build", {
        projectRoot,
        scanDirs: [{ absPath: srcDir }],
        generatedDir,
      });

      const configA: IocConfig = {
        discovery: { scanDirs: "src" },
        registrations: { Foo: { a: { default: true } } },
      };
      const configB: IocConfig = {
        discovery: { scanDirs: "src" },
        registrations: { Foo: { b: { default: true } } },
      };

      const [planA] = buildRegistrationPlan(contractMap, configA);
      const [planB] = buildRegistrationPlan(contractMap, configB);

      assert.strictEqual(planA.contractTypeRelImport, planB.contractTypeRelImport);
      assert.strictEqual(
        planA.contractTypeRelImport,
        "../generator/test-fixtures/contract-type-import/contract.js",
      );
      assert.strictEqual(planA.defaultImplementationName, "a");
      assert.strictEqual(planB.defaultImplementationName, "b");
    });
  });
});
