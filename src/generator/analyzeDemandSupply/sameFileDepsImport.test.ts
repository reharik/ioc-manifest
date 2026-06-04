import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { buildManifestArtifactSources } from "../writeManifest.js";
import { analyzeDemandSupply } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "../test-fixtures/same-file-deps");
const factoryFile = path.join(fixtureDir, "buildSameFileDeps.ts");
const projectRoot = path.join(__dirname, "../..");
const generatedDir = path.join(projectRoot, "generated");
const scanDirs = [{ absPath: fixtureDir }];

const makeProgram = (): ts.Program =>
  ts.createProgram({
    rootNames: [factoryFile],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });

const factories = [
  {
    contractName: "SomeService",
    contractTypeRelImport: "../test-fixtures/same-file-deps/buildSameFileDeps.js",
    implementationName: "someService",
    exportName: "buildSomeService",
    registrationKey: "someService",
    modulePath: "buildSameFileDeps.ts",
    relImport: "../test-fixtures/same-file-deps/buildSameFileDeps.js",
  },
] as const;

describe("same-file deps property imports", () => {
  describe("When a deps property type is declared in the factory file", () => {
    it("should emit an import for Config in ioc-registry.types.ts", () => {
      const program = makeProgram();
      const result = analyzeDemandSupply(factories, {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
      });

      const configEntry = result.entries.find((e) => e.key === "config");
      assert.ok(configEntry);
      assert.strictEqual(configEntry.typeRef.typeName, "Config");
      assert.ok(
        configEntry.typeRef.imports.some(
          (imp) =>
            imp.typeName === "Config" &&
            imp.relImport.includes("buildSameFileDeps.js"),
        ),
        `expected Config import from factory file, got ${JSON.stringify(configEntry.typeRef.imports)}`,
      );

      const { typesSource } = buildManifestArtifactSources(
        factories,
        [],
        undefined,
        path.join(generatedDir, "ioc-manifest.ts"),
        "ioc-manifest",
        { demandSupply: result },
      );

      assert.match(
        typesSource,
        /import type \{[\s\S]*\bConfig\b[\s\S]*\} from "[^"]*buildSameFileDeps\.js";/,
      );
      assert.match(typesSource, /\bconfig:\s*Config;/);
    });
  });
});
