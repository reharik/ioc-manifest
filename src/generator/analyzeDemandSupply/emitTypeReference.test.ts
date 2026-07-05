import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { buildManifestArtifactSources } from "../writeManifest.js";
import { analyzeDemandSupply } from "./index.js";
import { emitTypeReference, tryEmitTypeReference } from "./emitTypeReference.js";

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

const factoryReturnType = (
  program: ts.Program,
  factoryFile: string,
  exportName: string,
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
  const sig = checker.getSignatureFromDeclaration(decl.initializer);
  assert.ok(sig);
  return checker.getReturnTypeOfSignature(sig);
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

  describe("When deps use compound and builtin types", () => {
    const compoundFile = path.join(fixtureDir, "compound-type-deps.ts");

    it("should emit primitives, unions, lib types, arrays, and tuples without imports", () => {
      const program = makeProgram([compoundFile]);
      const checker = program.getTypeChecker();
      const sf = program.getSourceFile(compoundFile)!;
      const ctx = emitCtxForFile(program, sf);

      const expectInline = (
        propName: string,
        expectedTypeName: string,
      ): void => {
        const ref = emitTypeReference(
          checker,
          depsPropertyType(program, sf.fileName, "buildCompound", propName),
          ctx,
        );
        assert.ok(ref, propName);
        assert.strictEqual(ref.typeName, expectedTypeName, propName);
        assert.deepStrictEqual(ref.imports, [], propName);
      };

      expectInline("maybeId", "string | undefined");
      expectInline("createdAt", "Date");
      expectInline("pending", "Promise<string>");
      expectInline("tags", "string[]");
      expectInline("pair", "[string, number]");
      expectInline("primitiveObject", "object");
      expectInline("boxedObject", "Object");
      expectInline(
        "branded",
        "string & { readonly __brand: unique symbol; }",
      );
    });

    it("should emit mixed primitive and named types with a single import", () => {
      const program = makeProgram([compoundFile]);
      const checker = program.getTypeChecker();
      const sf = program.getSourceFile(compoundFile)!;
      const ctx = emitCtxForFile(program, sf);
      const ref = emitTypeReference(
        checker,
        depsPropertyType(program, sf.fileName, "buildCompound", "mixed"),
        ctx,
      );
      assert.ok(ref);
      assert.strictEqual(ref.typeName, "string | Database");
      assert.strictEqual(ref.imports.length, 1);
      assert.strictEqual(ref.imports[0]?.typeName, "Database");
      assert.match(ref.imports[0]?.relImport ?? "", /contracts\.js$/);
    });
  });

  describe("When a factory returns an imported generic instantiation", () => {
    it("should emit the base name with its named type argument and merge both imports", () => {
      const program = makeProgram();
      const checker = program.getTypeChecker();
      const factoryFile = path.join(fixtureDir, "factories.ts");
      const sf = program.getSourceFile(factoryFile)!;
      const ctx = emitCtxForFile(program, sf);
      const ref = emitTypeReference(
        checker,
        factoryReturnType(program, factoryFile, "buildNotificationStrategy"),
        ctx,
      );
      assert.ok(ref);
      assert.strictEqual(ref.typeName, "Strategy<NotificationPayload>");
      assert.strictEqual(ref.imports.length, 2);
      const strategyImport = ref.imports.find((i) => i.typeName === "Strategy");
      const payloadImport = ref.imports.find(
        (i) => i.typeName === "NotificationPayload",
      );
      assert.ok(strategyImport, "base import present");
      assert.ok(payloadImport, "argument import present");
      assert.match(strategyImport.relImport, /contracts\.js$/);
      assert.match(payloadImport.relImport, /contracts\.js$/);
    });

    it("should inline a string-literal type argument without an extra import", () => {
      const program = makeProgram();
      const checker = program.getTypeChecker();
      const factoryFile = path.join(fixtureDir, "factories.ts");
      const sf = program.getSourceFile(factoryFile)!;
      const ctx = emitCtxForFile(program, sf);
      const ref = emitTypeReference(
        checker,
        factoryReturnType(program, factoryFile, "buildLiteralStrategy"),
        ctx,
      );
      assert.ok(ref);
      assert.strictEqual(ref.typeName, 'Strategy<"album.shared">');
      assert.strictEqual(ref.imports.length, 1);
      assert.strictEqual(ref.imports[0]?.typeName, "Strategy");
      assert.match(ref.imports[0]?.relImport ?? "", /contracts\.js$/);
    });
  });

  describe("When a union contains an unresolvable type parameter member", () => {
    it("should name the compound type and failing constituent on the property", () => {
      const file = path.join(fixtureDir, "_generic-union.ts");
      const src = `export const build = <T,>({ foo }: { foo: string | T }): void => {};`;
      fs.writeFileSync(file, src);
      try {
        const program = ts.createProgram({
          rootNames: [file],
          options: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            strict: true,
            noEmit: true,
          },
        });
        const checker = program.getTypeChecker();
        const sf = program.getSourceFile(file);
        assert.ok(sf);
        const fn = sf.statements.find(ts.isVariableStatement)!.declarationList
          .declarations[0]!.initializer as ts.ArrowFunction;
        const prop = checker
          .getPropertiesOfType(
            checker.getApparentType(
              checker.getTypeAtLocation(fn.parameters[0]!),
            ),
          )
          .find((p) => p.getName() === "foo")!;
        const propType = checker.getTypeOfSymbol(prop);
        const result = tryEmitTypeReference(
          checker,
          propType,
          emitCtxForFile(program, sf),
          { propertyName: "foo" },
        );
        assert.strictEqual(result.ok, false);
        if (!result.ok) {
          assert.match(
            result.message,
            /Cannot resolve import for type "T" in compound type "string \| T"/,
          );
          assert.match(result.message, /on property "foo"/);
        }
      } finally {
        fs.unlinkSync(file);
      }
    });
  });
});
