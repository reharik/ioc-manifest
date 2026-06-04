import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import {
  isNominallyAssignable,
  resolveDeclaredBaseType,
} from "./baseTypeAssignability.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractsPath = path.join(
  __dirname,
  "test-fixtures",
  "nominal-assignability",
  "contracts.ts",
);
const otherMarkerPath = path.join(
  __dirname,
  "test-fixtures",
  "nominal-assignability",
  "other-marker.ts",
);

const makeProgram = (roots: readonly string[]): ts.Program =>
  ts.createProgram({
    rootNames: [...roots],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });

const declaredType = (
  checker: ts.TypeChecker,
  program: ts.Program,
  name: string,
): ts.Type => {
  const resolved = resolveDeclaredBaseType(program, checker, name);
  assert.strictEqual(resolved.ok, true);
  if (!resolved.ok) {
    throw new Error("expected resolved type");
  }
  return resolved.type;
};

const declaredTypeInFile = (
  checker: ts.TypeChecker,
  program: ts.Program,
  filePath: string,
  name: string,
): ts.Type => {
  const sourceFile = program.getSourceFile(path.normalize(filePath));
  assert.ok(sourceFile);
  for (const stmt of sourceFile.statements) {
    const declName =
      ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)
        ? stmt.name.text
        : undefined;
    if (declName !== name) {
      continue;
    }
    const sym = checker.getSymbolAtLocation(stmt.name);
    assert.ok(sym);
    return checker.getDeclaredTypeOfSymbol(sym);
  }
  throw new Error(`type ${name} not found in ${filePath}`);
};

describe("isNominallyAssignable", () => {
  describe("When heritage is transitive across multiple levels", () => {
    it("should match a deep interface to the root marker base", () => {
      const program = makeProgram([contractsPath]);
      const checker = program.getTypeChecker();
      const base = declaredType(checker, program, "MarkerBase");
      const deep = declaredType(checker, program, "Deep");
      assert.strictEqual(isNominallyAssignable(checker, deep, base), true);
    });
  });

  describe("When membership is declared via type-alias intersection", () => {
    it("should match the intersection alias to the marker base", () => {
      const program = makeProgram([contractsPath]);
      const checker = program.getTypeChecker();
      const base = declaredType(checker, program, "MarkerBase");
      const viaIntersection = declaredType(checker, program, "ViaIntersection");
      assert.strictEqual(
        isNominallyAssignable(checker, viaIntersection, base),
        true,
      );
    });
  });

  describe("When the alias RHS is a union", () => {
    it("should not treat the union as nominal heritage to the marker base", () => {
      const program = makeProgram([contractsPath]);
      const checker = program.getTypeChecker();
      const base = declaredType(checker, program, "MarkerBase");
      const viaUnion = declaredType(checker, program, "ViaUnion");
      assert.strictEqual(isNominallyAssignable(checker, viaUnion, base), false);
    });
  });

  describe("When two files declare the same type name", () => {
    it("should not match across unrelated symbols with the same name", () => {
      const program = makeProgram([contractsPath, otherMarkerPath]);
      const checker = program.getTypeChecker();
      const localBase = declaredTypeInFile(
        checker,
        program,
        contractsPath,
        "MarkerBase",
      );
      const otherBase = declaredTypeInFile(
        checker,
        program,
        otherMarkerPath,
        "MarkerBase",
      );
      const leaf = declaredTypeInFile(
        checker,
        program,
        contractsPath,
        "Leaf",
      );
      assert.strictEqual(isNominallyAssignable(checker, leaf, localBase), true);
      assert.strictEqual(
        isNominallyAssignable(checker, leaf, otherBase),
        false,
      );
    });
  });
});
