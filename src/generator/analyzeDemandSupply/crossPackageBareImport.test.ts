import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { buildManifestArtifactSources } from "../writeManifest.js";
import { analyzeDemandSupply } from "./index.js";
import { emitTypeReference } from "./emitTypeReference.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "../test-fixtures/cross-package-bare");
const appDir = path.join(fixtureRoot, "app");
const projectRoot = appDir;
const generatedDir = path.join(appDir, "generated");
const factoryFile = path.join(appDir, "src/buildService.ts");
const scanDirs = [{ absPath: path.join(appDir, "src") }];

const makeProgram = (): ts.Program => {
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
  assert.strictEqual(parsed.errors.length, 0);
  return ts.createProgram({
    rootNames: [factoryFile],
    options: parsed.options,
  });
};

const depsPropertyType = (
  program: ts.Program,
  propName: string,
): ts.Type => {
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(factoryFile);
  assert.ok(sf);
  const stmt = sf.statements.find(
    (s) =>
      ts.isVariableStatement(s) &&
      s.declarationList.declarations.some(
        (d) => ts.isIdentifier(d.name) && d.name.text === "buildSomeService",
      ),
  );
  assert.ok(stmt && ts.isVariableStatement(stmt));
  const decl = stmt.declarationList.declarations.find(
    (d) => ts.isIdentifier(d.name) && d.name.text === "buildSomeService",
  );
  assert.ok(decl?.initializer && ts.isArrowFunction(decl.initializer));
  const param = decl.initializer.parameters[0];
  const paramType = checker.getTypeAtLocation(param);
  const prop = checker
    .getPropertiesOfType(checker.getApparentType(paramType))
    .find((p) => p.getName() === propName);
  assert.ok(prop);
  return checker.getTypeOfSymbol(prop);
};

describe("cross-package bare import recovery", () => {
  describe("When a factory imports a type via a path-mapped bare specifier", () => {
    it("should emit the bare specifier instead of a deep relative path", () => {
      const program = makeProgram();
      const checker = program.getTypeChecker();
      const sf = program.getSourceFile(factoryFile);
      assert.ok(sf);
      const propType = depsPropertyType(program, "mediaStorage");
      const ref = emitTypeReference(checker, propType, {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
        contextSourceFile: sf,
      });
      assert.ok(ref);
      assert.strictEqual(ref.typeName, "MediaStorage");
      assert.strictEqual(ref.imports.length, 1);
      const imp = ref.imports[0];
      assert.ok(imp);
      assert.strictEqual(
        imp.relImport,
        "@test/lib-foo",
        `expected bare specifier, got ${imp.relImport}`,
      );
      assert.strictEqual(imp.typeName, "MediaStorage");
      assert.strictEqual(imp.useDefaultImport, false);
    });

    it("should preserve bare specifier in ioc-registry.types.ts via writeManifest", async () => {
      const program = makeProgram();
      const factories = [
        {
          contractName: "SomeService",
          contractTypeRelImport: "./buildService.js",
          implementationName: "someService",
          exportName: "buildSomeService",
          registrationKey: "someService",
          modulePath: "buildService.ts",
          relImport: "./buildService.js",
        },
      ] as const;

      const result = analyzeDemandSupply(factories, {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
      });

      const mediaStorage = result.entries.find((e) => e.key === "mediaStorage");
      assert.ok(mediaStorage);
      assert.strictEqual(mediaStorage.typeRef.imports[0]?.relImport, "@test/lib-foo");

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
        /import type \{ MediaStorage \} from "@test\/lib-foo";/,
      );
      assert.ok(!typesSource.includes("packages/lib-foo"));
    });
  });
});
