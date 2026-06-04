import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { buildManifestArtifactSources } from "../writeManifest.js";
import { analyzeDemandSupply } from "./index.js";
import { emitTypeReference } from "./emitTypeReference.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "../test-fixtures/demand-supply");
const projectRoot = path.join(__dirname, "../..");
const generatedDir = path.join(projectRoot, "generated");
const scanDirs = [{ absPath: fixtureDir }];

const makeProgram = (extraRoots: string[] = []): ts.Program =>
  ts.createProgram({
    rootNames: [
      path.join(fixtureDir, "contracts.ts"),
      path.join(fixtureDir, "factories.ts"),
      ...extraRoots,
    ],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });

const emitCtxForFile = (
  program: ts.Program,
  sourceFile: ts.SourceFile,
): {
  program: ts.Program;
  projectRoot: string;
  scanDirs: typeof scanDirs;
  generatedDir: string;
  contextSourceFile: ts.SourceFile;
} => ({
  program,
  projectRoot,
  scanDirs,
  generatedDir,
  contextSourceFile: sourceFile,
});

const depsPropertyType = (
  program: ts.Program,
  factoryFile: string,
  exportName: string,
  propName: string,
): ts.Type => {
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(factoryFile);
  assert.ok(sf);
  const stmt = sf.statements.find(
    (s) =>
      ts.isVariableStatement(s) &&
      s.declarationList.declarations.some(
        (d) => ts.isIdentifier(d.name) && d.name.text === exportName,
      ),
  );
  assert.ok(stmt && ts.isVariableStatement(stmt));
  const decl = stmt.declarationList.declarations.find(
    (d) => ts.isIdentifier(d.name) && d.name.text === exportName,
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

describe("emitTypeReference", () => {
  describe("When a deps property uses the string primitive", () => {
    it("should emit inline string without a typescript package import", () => {
      const program = makeProgram([path.join(fixtureDir, "primitive-deps.ts")]);
      const checker = program.getTypeChecker();
      const sf = program.getSourceFile(path.join(fixtureDir, "primitive-deps.ts"))!;
      const propType = depsPropertyType(
        program,
        sf.fileName,
        "buildAuthService",
        "viewerId",
      );
      const ctx = emitCtxForFile(program, sf);
      const ref = emitTypeReference(checker, propType, ctx);
      assert.ok(ref);
      assert.strictEqual(ref.typeName, "string");
      assert.deepStrictEqual(ref.imports, []);
    });
  });

  describe("When analyzing primitive-deps through demand supply and writeManifest", () => {
    it("should not import String from typescript in ioc-registry.types.ts", () => {
      const program = makeProgram([path.join(fixtureDir, "primitive-deps.ts")]);
      const factories = [
        {
          contractName: "AuthService",
          contractTypeRelImport: "../test-fixtures/demand-supply/contracts.js",
          implementationName: "authService",
          exportName: "buildAuthService",
          registrationKey: "authService",
          modulePath: "primitive-deps.ts",
          relImport: "./primitive-deps.js",
        },
      ] as const;

      const result = analyzeDemandSupply(factories, {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
      });

      const viewerId = result.entries.find((e) => e.key === "viewerId");
      assert.ok(viewerId);
      assert.strictEqual(viewerId.typeRef.typeName, "string");
      assert.deepStrictEqual(viewerId.typeRef.imports, []);

      const { typesSource } = buildManifestArtifactSources(
        factories,
        [],
        undefined,
        path.join(generatedDir, "ioc-manifest.ts"),
        "ioc-manifest",
        { demandSupply: result },
      );

      assert.ok(!typesSource.includes("from 'typescript'"));
      assert.ok(!typesSource.includes('from "typescript"'));
      assert.match(typesSource, /viewerId:\s*string;/);
    });
  });
});
