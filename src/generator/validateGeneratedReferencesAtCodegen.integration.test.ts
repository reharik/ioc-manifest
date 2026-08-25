import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { validateGeneratedReferencesAtCodegen } from "./validateGeneratedReferencesAtCodegen.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(
  __dirname,
  "test-fixtures/generated-reference-interception",
);
const coldFixtureDir = path.join(fixtureDir, "cold");
const generatedDir = path.join(fixtureDir, "generated");
const coldGeneratedDir = path.join(coldFixtureDir, "generated");

const barrelReexportPath = path.join(fixtureDir, "barrelReexport.ts");
const starReexportPath = path.join(fixtureDir, "starReexport.ts");
const importTypeAccessPath = path.join(fixtureDir, "importTypeAccess.ts");
const cleanReexportPath = path.join(fixtureDir, "cleanReexport.ts");
const contractsPath = path.join(fixtureDir, "contracts.ts");
const coldBarrelReexportPath = path.join(coldFixtureDir, "barrelReexport.ts");
const coldImportTypeAccessPath = path.join(coldFixtureDir, "importTypeAccess.ts");

const makeProgram = (rootNames: readonly string[]): ts.Program =>
  ts.createProgram({
    rootNames: [...rootNames],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });

const runValidator = (
  files: readonly string[],
  gd: string = generatedDir,
): void =>
  validateGeneratedReferencesAtCodegen(files, makeProgram(files), {
    projectRoot: fixtureDir,
    generatedDir: gd,
  });

const messageOfThrow = (fn: () => void): string => {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  assert.fail("expected the validator to throw");
};

describe("validateGeneratedReferencesAtCodegen", () => {
  describe("When a scanned barrel re-exports a generated group alias by name", () => {
    it("throws naming the file, showing the form, and instructing a direct import", () => {
      const message = messageOfThrow(() => runValidator([barrelReexportPath]));
      assert.match(message, /barrelReexport\.ts:2/);
      assert.match(
        message,
        /export type \{ Channels \} from "\.\/generated\/ioc-registry\.types\.js"/,
      );
      assert.match(
        message,
        /Import directly from the generated registry file instead of re-exporting it/,
      );
    });
  });

  describe("When a scanned file star re-exports the generated registry file", () => {
    it("throws with the export * form", () => {
      const message = messageOfThrow(() => runValidator([starReexportPath]));
      assert.match(message, /starReexport\.ts:2/);
      assert.match(
        message,
        /export \* from "\.\/generated\/ioc-registry\.types\.js"/,
      );
    });
  });

  describe("When a scanned file uses typeof import(…) / import(…).X on the generated file", () => {
    it("throws for both forms, instructing a regular type import", () => {
      const message = messageOfThrow(() => runValidator([importTypeAccessPath]));
      assert.match(message, /importTypeAccess\.ts:2/);
      assert.match(
        message,
        /typeof import\("\.\/generated\/ioc-registry\.types\.js"\)/,
      );
      assert.match(message, /importTypeAccess\.ts:5/);
      assert.match(
        message,
        /import\("\.\/generated\/ioc-registry\.types\.js"\)\.IocGeneratedCradle/,
      );
      assert.match(message, /Use a regular type import/);
    });
  });

  describe("When a scanned file re-exports from a non-generated file (negative case)", () => {
    it("does not throw", () => {
      runValidator([cleanReexportPath, contractsPath]);
    });
  });

  describe("When several scanned files offend at once", () => {
    it("aggregates every offender into one error", () => {
      const message = messageOfThrow(() =>
        runValidator([
          barrelReexportPath,
          starReexportPath,
          importTypeAccessPath,
          cleanReexportPath,
        ]),
      );
      assert.match(message, /barrelReexport\.ts/);
      assert.match(message, /starReexport\.ts/);
      assert.match(message, /importTypeAccess\.ts/);
      assert.doesNotMatch(message, /cleanReexport\.ts/);
    });
  });

  // COLD START: the generated file referenced by the cold fixtures does not exist on disk, so
  // detection must work off the source text alone — the exact scenario where a type-resolution
  // fallback would deadlock (2.3.3's chicken-and-egg) instead of erroring usefully.
  describe("When the generated registry file does not exist yet (cold start)", () => {
    it("fixture precondition: the cold generated dir is absent", () => {
      assert.strictEqual(fs.existsSync(coldGeneratedDir), false);
    });

    it("still throws for a barrel re-export", () => {
      const message = messageOfThrow(() =>
        runValidator([coldBarrelReexportPath], coldGeneratedDir),
      );
      assert.match(message, /cold\/barrelReexport\.ts:2/);
      assert.match(
        message,
        /Import directly from the generated registry file instead of re-exporting it/,
      );
    });

    it("still throws for an import() type reference", () => {
      const message = messageOfThrow(() =>
        runValidator([coldImportTypeAccessPath], coldGeneratedDir),
      );
      assert.match(message, /cold\/importTypeAccess\.ts:3/);
      assert.match(message, /Use a regular type import/);
    });
  });
});
