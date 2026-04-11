import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import {
  cradleTypeImportUsesDefaultExport,
  resolveContractTypeSourceFile,
} from "./contractTypeSourceFile.js";
import { computeManifestModuleSpecifier } from "./manifestPaths.js";

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
      const hit = resolveContractTypeSourceFile(program, generatedDir, rel, []);
      assert.ok(hit !== undefined);
      assert.strictEqual(path.normalize(hit.fileName), path.normalize(defaultRouterFile));
    });

    it("should resolve importPrefix subpath specifiers to the package source file", () => {
      const pkgFixture = path.join(
        __dirname,
        "test-fixtures/scan-prefix-contract/pkg",
      );
      const contractFile = path.join(
        pkgFixture,
        "src/svc/readContract.ts",
      );
      const program = makeProgram([contractFile]);
      const generatedDirUnused = path.join(pkgFixture, "dist/generated");
      const scanDirs = [
        {
          absPath: pkgFixture,
          importPrefix: "@acme/lib",
          importMode: "subpath" as const,
        },
      ];
      const hit = resolveContractTypeSourceFile(
        program,
        generatedDirUnused,
        "@acme/lib/src/svc/readContract.js",
        scanDirs,
        "PackageOwnedReadContract",
      );
      assert.ok(hit !== undefined);
      assert.strictEqual(path.normalize(hit.fileName), path.normalize(contractFile));
    });

    it("should treat undefined scanDirs as empty when resolving non-relative specifiers", () => {
      const pkgFixture = path.join(
        __dirname,
        "test-fixtures/scan-prefix-contract/pkg",
      );
      const contractFile = path.join(
        pkgFixture,
        "src/svc/readContract.ts",
      );
      const program = makeProgram([contractFile]);
      const generatedDirUnused = path.join(pkgFixture, "dist/generated");
      const hit = resolveContractTypeSourceFile(
        program,
        generatedDirUnused,
        "@acme/lib/src/svc/readContract.js",
        undefined,
        "PackageOwnedReadContract",
      );
      assert.strictEqual(hit, undefined);
    });

    it("should resolve app-local relative imports when generatedDir is under sourceRoot/src", () => {
      const projectRoot = path.join(__dirname, "test-fixtures/scan-prefix-contract");
      const srcRoot = path.join(projectRoot, "app/src");
      const controllerFile = path.join(srcRoot, "controllers/localContract.ts");
      const generatedUnderSrc = path.join(srcRoot, "di/generated");
      const program = makeProgram([controllerFile]);
      const scanDirs = [{ absPath: srcRoot }];
      const rel = computeManifestModuleSpecifier(
        controllerFile,
        generatedUnderSrc,
        scanDirs,
      );
      const hit = resolveContractTypeSourceFile(
        program,
        generatedUnderSrc,
        rel,
        scanDirs,
        "LocalContract",
      );
      assert.ok(hit !== undefined);
      assert.strictEqual(path.normalize(hit.fileName), path.normalize(controllerFile));
    });

    it("should resolve a bare package specifier to the declaration module in the program", () => {
      const fixture = path.join(__dirname, "test-fixtures/bare-import/buildCompilerOptions.ts");
      const program = makeProgram([fixture]);
      const hit = resolveContractTypeSourceFile(
        program,
        generatedDir,
        "typescript",
        [],
        "CompilerOptions",
      );
      assert.ok(hit !== undefined);
      assert.match(
        hit.fileName.replace(/\\/g, "/"),
        /node_modules\/typescript\//,
      );
    });
  });
});
