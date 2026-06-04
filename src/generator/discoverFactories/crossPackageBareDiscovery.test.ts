import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { discoverFactories } from "./discoverFactories.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "../test-fixtures/cross-package-bare");
const appDir = path.join(fixtureRoot, "app");
const projectRoot = appDir;
const generatedDir = path.join(appDir, "generated");
const scanDirs = [{ absPath: path.join(appDir, "src") }];

const loadFixtureProgram = (factoryFile: string): ts.Program => {
  const configPath = path.join(fixtureRoot, "tsconfig.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.ok(!configFile.error);
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    fixtureRoot,
    undefined,
    configPath,
  );
  return ts.createProgram({
    rootNames: [factoryFile],
    options: parsed.options,
  });
};

describe("discoverFactories bare-specifier recovery", () => {
  describe("When a factory return type is imported via a path-mapped bare specifier", () => {
    it("should set contractTypeRelImport to the bare specifier", () => {
      const factoryFile = path.join(appDir, "src/buildStorageFactory.ts");
      const program = loadFixtureProgram(factoryFile);
      const { contractMap } = discoverFactories(
        [factoryFile],
        program,
        projectRoot,
        "build",
        { projectRoot, scanDirs, generatedDir },
      );

      const impls = contractMap.get("MediaStorage");
      assert.ok(impls);
      const factory = impls.get("storage");
      assert.ok(factory);
      assert.strictEqual(factory.contractTypeRelImport, "@test/lib-foo");
    });
  });
});
