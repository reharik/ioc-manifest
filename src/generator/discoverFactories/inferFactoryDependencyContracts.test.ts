import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { inferDependencyContractNames } from "./inferFactoryDependencyContracts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "../test-fixtures/infer-deps");

const KNOWN_CONTRACTS = new Set([
  "Config",
  "Logger",
  "KnexConfig",
  "GraphQLServer",
  "KoaServer",
  "YogaApp",
  "MediaController",
]);

const makeProgram = (): { program: ts.Program; checker: ts.TypeChecker } => {
  const roots = [
    path.join(fixtureDir, "contracts.ts"),
    path.join(fixtureDir, "mock-cradle.ts"),
    path.join(fixtureDir, "factories.ts"),
  ];
  const program = ts.createProgram({
    rootNames: roots,
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });
  return { program, checker: program.getTypeChecker() };
};

const findExportedFactory = (
  sourceFile: ts.SourceFile,
  exportName: string,
): ts.FunctionLike | undefined => {
  let found: ts.FunctionLike | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === exportName &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      found = node;
      return;
    }
    if (ts.isVariableStatement(node)) {
      const isExported = node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (!isExported) {
        ts.forEachChild(node, visit);
        return;
      }
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.name.text !== exportName) {
          continue;
        }
        const init = decl.initializer;
        if (
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          found = init;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
};

const getFactoryDecl = (
  program: ts.Program,
  factoriesPath: string,
  exportName: string,
): ts.FunctionLike => {
  const resolved = path.resolve(factoriesPath);
  const sourceFile =
    program.getSourceFile(resolved) ??
    program.getSourceFiles().find((sf) => path.normalize(sf.fileName) === resolved);
  assert.ok(sourceFile, `Expected source file at ${resolved}`);
  const decl = findExportedFactory(sourceFile, exportName);
  assert.ok(decl, `Expected exported factory ${exportName}`);
  return decl;
};

describe("inferDependencyContractNames", () => {
  describe("When the factory destructures a few properties from a wide cradle type", () => {
    it("should infer only those contracts and not the full reachable graph", () => {
      const { program, checker } = makeProgram();
      const factoriesPath = path.join(fixtureDir, "factories.ts");
      const decl = getFactoryDecl(program, factoriesPath, "buildKnexConfig");
      const deps = inferDependencyContractNames(checker, decl, KNOWN_CONTRACTS);
      assert.deepStrictEqual(deps, ["Config", "Logger"]);
    });
  });

  describe("When a high-level factory only lists logger in the binding", () => {
    it("should not include other cradle contracts like GraphQLServer or KoaServer", () => {
      const { program, checker } = makeProgram();
      const factoriesPath = path.join(fixtureDir, "factories.ts");
      const decl = getFactoryDecl(program, factoriesPath, "buildGraphQLServer");
      const deps = inferDependencyContractNames(checker, decl, KNOWN_CONTRACTS);
      assert.deepStrictEqual(deps, ["Logger"]);
    });
  });

  describe("When the factory’s return contract is not in the binding pattern", () => {
    it("should not add the factory’s own contract as an inferred dependency", () => {
      const { program, checker } = makeProgram();
      const factoriesPath = path.join(fixtureDir, "factories.ts");
      const decl = getFactoryDecl(program, factoriesPath, "buildGraphQLServer");
      const deps = inferDependencyContractNames(checker, decl, KNOWN_CONTRACTS);
      assert.ok(!deps.includes("GraphQLServer"));
    });
  });

  describe("When the first parameter is a single identifier typed as the full cradle", () => {
    it("should return an empty list", () => {
      const { program, checker } = makeProgram();
      const factoriesPath = path.join(fixtureDir, "factories.ts");
      const decl = getFactoryDecl(program, factoriesPath, "buildWithFullCradleParam");
      const deps = inferDependencyContractNames(checker, decl, KNOWN_CONTRACTS);
      assert.deepStrictEqual(deps, []);
    });
  });

  describe("When the binding pattern uses a rest element", () => {
    it("should omit inference", () => {
      const { program, checker } = makeProgram();
      const factoriesPath = path.join(fixtureDir, "factories.ts");
      const decl = getFactoryDecl(program, factoriesPath, "buildWithRest");
      const deps = inferDependencyContractNames(checker, decl, KNOWN_CONTRACTS);
      assert.deepStrictEqual(deps, []);
    });
  });

  describe("When the binding explicitly includes the factory’s contract slot", () => {
    it("should include that contract", () => {
      const { program, checker } = makeProgram();
      const factoriesPath = path.join(fixtureDir, "factories.ts");
      const decl = getFactoryDecl(
        program,
        factoriesPath,
        "buildGraphQLServerWithExplicitSelf",
      );
      const deps = inferDependencyContractNames(checker, decl, KNOWN_CONTRACTS);
      assert.deepStrictEqual(deps, ["GraphQLServer", "Logger"]);
    });
  });

  describe("When deps use a narrow inline object type", () => {
    it("should still infer only listed bindings", () => {
      const { program, checker } = makeProgram();
      const factoriesPath = path.join(fixtureDir, "factories.ts");
      const decl = getFactoryDecl(program, factoriesPath, "buildFromNarrowDeps");
      const deps = inferDependencyContractNames(checker, decl, KNOWN_CONTRACTS);
      assert.deepStrictEqual(deps, ["Logger"]);
    });
  });

  describe("When a binding renames a destructured property", () => {
    it("should resolve types using the object property key", () => {
      const { program, checker } = makeProgram();
      const factoriesPath = path.join(fixtureDir, "factories.ts");
      const decl = getFactoryDecl(program, factoriesPath, "buildRenamedBinding");
      const deps = inferDependencyContractNames(checker, decl, KNOWN_CONTRACTS);
      assert.deepStrictEqual(deps, ["Logger"]);
    });
  });
});
