import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import {
  formatCanonicalBaseTypeId,
  resolveCanonicalBaseTypeId,
} from "./canonicalBaseTypeId.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "test-fixtures/canonical-base-type");
const widgetBasePath = path.join(fixtureDir, "WidgetBase.ts");
const importsWidgetPath = path.join(fixtureDir, "importsWidget.ts");

const makeProgram = (rootNames: string[]): ts.Program => {
  const program = ts.createProgram({
    rootNames,
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });
  return program;
};

describe("formatCanonicalBaseTypeId", () => {
  describe("When given a declaration path and type name", () => {
    it("should produce normalized-path:typeName", () => {
      const id = formatCanonicalBaseTypeId(
        "/proj/src/types/Widget.ts",
        "Widget",
      );
      assert.strictEqual(id, `${path.normalize("/proj/src/types/Widget.ts")}:Widget`);
    });
  });
});

describe("resolveCanonicalBaseTypeId", () => {
  describe("When the base type is declared in a local source file", () => {
    it("should return an id pointing at that file", () => {
      const program = makeProgram([widgetBasePath]);
      const checker = program.getTypeChecker();
      const result = resolveCanonicalBaseTypeId(checker, {
        program,
        generatedDir: fixtureDir,
        scanDirs: [{ absPath: fixtureDir }],
      }, "WidgetBase");

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(
          result.baseTypeId,
          formatCanonicalBaseTypeId(widgetBasePath, "WidgetBase"),
        );
      }
    });
  });

  describe("When the base type is only imported from a local declaration via scan roots", () => {
    it("should resolve the id to the imported declaration file", () => {
      const program = makeProgram([importsWidgetPath, widgetBasePath]);
      const checker = program.getTypeChecker();
      const result = resolveCanonicalBaseTypeId(checker, {
        program,
        generatedDir: fixtureDir,
        scanDirs: [{ absPath: fixtureDir }],
      }, "WidgetBase");

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(
          result.baseTypeId,
          formatCanonicalBaseTypeId(widgetBasePath, "WidgetBase"),
        );
      }
    });
  });
});
