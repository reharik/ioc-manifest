import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import {
  cradleTypeImportUsesDefaultExport,
  resolveContractTypeSourceFile,
} from "./contractTypeSourceFile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "test-fixtures/default-export-contract");
const defaultRouterFile = path.join(fixtureDir, "defaultRouter.ts");
const aliasedDefaultRouterFile = path.join(fixtureDir, "aliasedDefaultRouter.ts");
const exportEqualsRouterFile = path.join(fixtureDir, "exportEqualsRouter.ts");
const namedWidgetFile = path.join(fixtureDir, "namedWidget.ts");
const generatedDir = path.join(__dirname, "../../src/generated");

const makeProgram = (roots: string[]): ts.Program =>
  ts.createProgram({
    rootNames: roots,
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });

describe("contractTypeSourceFile", () => {
  describe("When cradleTypeImportUsesDefaultExport runs on a module", () => {
    it("should return true when the contract exists only as the default export binding", () => {
      const program = makeProgram([defaultRouterFile]);
      const sf = program.getSourceFile(defaultRouterFile);
      assert.ok(sf !== undefined);
      assert.strictEqual(cradleTypeImportUsesDefaultExport(sf, "Router"), true);
    });

    it("should return true for export default Identifier when no named export exists", () => {
      const program = makeProgram([aliasedDefaultRouterFile]);
      const sf = program.getSourceFile(aliasedDefaultRouterFile);
      assert.ok(sf !== undefined);
      assert.strictEqual(cradleTypeImportUsesDefaultExport(sf, "Router"), true);
    });

    it("should return true for export = Name when no named export exists", () => {
      const program = makeProgram([exportEqualsRouterFile]);
      const sf = program.getSourceFile(exportEqualsRouterFile);
      assert.ok(sf !== undefined);
      assert.strictEqual(cradleTypeImportUsesDefaultExport(sf, "Router"), true);
    });

    it("should return false when the contract is a named export", () => {
      const program = makeProgram([namedWidgetFile]);
      const sf = program.getSourceFile(namedWidgetFile);
      assert.ok(sf !== undefined);
      assert.strictEqual(cradleTypeImportUsesDefaultExport(sf, "Widget"), false);
    });
  });

  describe("When resolveContractTypeSourceFile runs", () => {
    it("should resolve a relative contract import against generatedDir", () => {
      const rel = "../generator/test-fixtures/default-export-contract/defaultRouter.js";
      const program = makeProgram([defaultRouterFile, namedWidgetFile]);
      const hit = resolveContractTypeSourceFile(program, generatedDir, rel);
      assert.ok(hit !== undefined);
      assert.strictEqual(path.normalize(hit.fileName), path.normalize(defaultRouterFile));
    });
  });
});
