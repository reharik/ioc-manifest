import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import {
  factoryLifetimeMarkerKey,
  resolveLifetimeMarkersForFactories,
} from "./resolveLifetimeMarkers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "test-fixtures", "nominal-lifetime-markers");
const projectRoot = path.resolve(__dirname, "..", "..");
const srcDir = path.join(projectRoot, "src");
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

describe("nominal lifetime marker matching", () => {
  describe("When the marker is an empty interface", () => {
    it("should tag only factories whose return type declares extends on the marker", () => {
      const program = makeProgram();
      const { acceptedFactories } = discoverFactories(
        [factoriesPath],
        program,
        projectRoot,
        "build",
        { projectRoot, scanDirs: [{ absPath: srcDir }], generatedDir: "" },
        undefined,
      );

      const result = resolveLifetimeMarkersForFactories(
        acceptedFactories,
        { IScoped: "scoped" },
        { program, projectRoot, scanDirs: [{ absPath: srcDir }] },
      );

      const scopedFactory = acceptedFactories.find(
        (factory) => factory.exportName === "buildScopedService",
      );
      const plainFactory = acceptedFactories.find(
        (factory) => factory.exportName === "buildPlainService",
      );
      assert.ok(scopedFactory);
      assert.ok(plainFactory);
      assert.equal(
        result.get(factoryLifetimeMarkerKey(scopedFactory!)),
        "scoped",
      );
      assert.equal(result.has(factoryLifetimeMarkerKey(plainFactory!)), false);
      assert.equal(result.size, 1);
    });
  });
});
