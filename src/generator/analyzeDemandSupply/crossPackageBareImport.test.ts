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
const scanDirs = [{ absPath: path.join(appDir, "src") }];

const loadFixtureProgram = (rootNames: string[]): ts.Program => {
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
  return ts.createProgram({ rootNames, options: parsed.options });
};

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

const emitDepsImport = (
  factoryRel: string,
  exportName: string,
  propName: string,
): EmittedTypeReference => {
  const factoryFile = path.join(appDir, "src", factoryRel);
  const program = loadFixtureProgram([factoryFile]);
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(factoryFile);
  assert.ok(sf);
  const ref = emitTypeReference(
    checker,
    depsPropertyType(program, factoryFile, exportName, propName),
    {
      program,
      projectRoot,
      scanDirs,
      generatedDir,
      contextSourceFile: sf,
    },
  );
  assert.ok(ref);
  return ref;
};

type EmittedTypeReference = NonNullable<
  ReturnType<typeof emitTypeReference>
>;

describe("cross-package bare import recovery", () => {
  describe("When a factory imports a type via a path-mapped bare specifier", () => {
    it("should emit the bare specifier instead of a deep relative path", () => {
      const ref = emitDepsImport("buildService.ts", "buildSomeService", "mediaStorage");
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
      const factoryFile = path.join(appDir, "src/buildService.ts");
      const program = loadFixtureProgram([factoryFile]);
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

  describe("When the factory uses import variants for cross-package types", () => {
    it("should preserve bare specifier for renamed type-only imports and emit the export name", () => {
      const ref = emitDepsImport(
        "buildRenamedImport.ts",
        "buildRenamedService",
        "mediaStorage",
      );
      assert.strictEqual(ref.typeName, "MediaStorage");
      assert.strictEqual(ref.imports[0]?.relImport, "@test/lib-foo");
      assert.strictEqual(ref.imports[0]?.useDefaultImport, false);
    });

    it("should preserve subpath bare specifiers", () => {
      const ref = emitDepsImport(
        "buildSubpathImport.ts",
        "buildSubpathService",
        "item",
      );
      assert.strictEqual(ref.typeName, "SubpathType");
      assert.strictEqual(ref.imports[0]?.relImport, "@test/lib-foo/subpath");
    });

    it("should recover bare specifiers from import { type Name } syntax", () => {
      const ref = emitDepsImport(
        "buildTypeOnlyImport.ts",
        "buildTypeOnlyService",
        "mediaStorage",
      );
      assert.strictEqual(ref.imports[0]?.relImport, "@test/lib-foo");
    });

    it("should recover default-import bare specifiers and emit a default import", () => {
      const ref = emitDepsImport(
        "buildDefaultImport.ts",
        "buildDefaultService",
        "widget",
      );
      assert.strictEqual(ref.imports[0]?.relImport, "@test/lib-foo/default");
      assert.strictEqual(ref.imports[0]?.useDefaultImport, true);
      assert.strictEqual(ref.typeName, "DefaultWidget");
    });
  });

  describe("When generated registry types include a relative import that escapes the package root", () => {
    it("should warn without failing codegen", () => {
      const program = loadFixtureProgram([
        path.join(appDir, "src/buildService.ts"),
      ]);
      const escapingImport = "../../packages/lib-foo/src/MediaStorage.js";
      const warnings: string[] = [];
      const prevWarn = console.warn;
      console.warn = (msg: unknown) => {
        warnings.push(String(msg));
      };
      try {
        buildManifestArtifactSources(
          [],
          [],
          undefined,
          path.join(generatedDir, "ioc-manifest.ts"),
          "ioc-manifest",
          {
            demandSupply: {
              entries: [
                {
                  key: "mediaStorage",
                  typeRef: {
                    typeName: "MediaStorage",
                    imports: [
                      {
                        typeName: "MediaStorage",
                        relImport: escapingImport,
                        useDefaultImport: false,
                      },
                    ],
                  },
                  classification: "external",
                },
              ],
              externalKeys: ["mediaStorage"],
              scopeProvidedKeys: [],
            },
            registryTypesBuildContext: {
              program,
              generatedDir,
              scanDirs,
              projectRoot,
            },
          },
        );
      } finally {
        console.warn = prevWarn;
      }

      const joined = warnings.join("\n");
      assert.match(joined, /\[ioc-warn\]/);
      assert.match(joined, /escapes the package root/);
      assert.match(joined, /packages\/lib-foo/);
    });
  });
});
