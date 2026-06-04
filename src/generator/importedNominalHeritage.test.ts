import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { buildGroupPlan } from "../groups/resolveGroupPlan.js";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import {
  factoryLifetimeMarkerKey,
  resolveLifetimeMarkersForFactories,
} from "./resolveLifetimeMarkers.js";
import { buildRegistrationPlan } from "./resolveRegistrationPlan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(
  __dirname,
  "test-fixtures",
  "imported-nominal-heritage",
);
const projectRoot = path.resolve(__dirname, "..", "..");
const srcDir = path.join(projectRoot, "src");
const generatedDir = path.join(srcDir, "generated");
const baseTypesPath = path.join(fixtureDir, "base-types.ts");
const serviceTypesPath = path.join(fixtureDir, "service-types.ts");
const contractsPath = path.join(fixtureDir, "contracts.ts");
const factoriesPath = path.join(fixtureDir, "factories.ts");

const makeProgram = (): ts.Program =>
  ts.createProgram({
    rootNames: [
      baseTypesPath,
      serviceTypesPath,
      contractsPath,
      factoriesPath,
    ],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });

describe("imported nominal heritage", () => {
  describe("When a service extends an imported mid-type", () => {
    it("should resolve lifetime markers through transitive imported heritage", () => {
      const program = makeProgram();
      const { contractMap, acceptedFactories } = discoverFactories(
        [factoriesPath],
        program,
        projectRoot,
        "build",
        { projectRoot, scanDirs: [{ absPath: srcDir }], generatedDir },
        undefined,
      );
      const result = resolveLifetimeMarkersForFactories(
        acceptedFactories,
        { MarkerBase: "scoped" },
        { program, projectRoot, scanDirs: [{ absPath: srcDir }] },
      );
      const serviceFactory = acceptedFactories.find(
        (factory) => factory.exportName === "buildService",
      );
      assert.ok(serviceFactory);
      assert.equal(
        result.get(factoryLifetimeMarkerKey(serviceFactory!)),
        "scoped",
      );
    });

    it("should include the service in a group whose base type is the mid interface", () => {
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
      const groupResult = buildGroupPlan(
        { services: { kind: "collection", baseType: "Mid" } },
        plans,
        { program, generatedDir, scanDirs: [{ absPath: srcDir }] },
      );
      assert.ok(groupResult);
      const keys = groupResult!.manifest.services.members
        .map((member) => member.registrationKey)
        .sort();
      assert.deepStrictEqual(keys, ["serviceContract"]);
    });
  });
});
