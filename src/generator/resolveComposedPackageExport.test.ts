import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildValueLoadConditionOrder,
  pickExportRelativePath,
  resolvePackageExportPath,
} from "./resolveComposedPackageExport.js";

const writeHostRoot = (root: string): void => {
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "test-host", type: "module" }),
  );
};

const writeConditionalExportFixture = (root: string): string => {
  const pkgDir = path.join(root, "node_modules", "@test", "media-core");
  mkdirSync(pkgDir, { recursive: true });
  mkdirSync(path.join(pkgDir, "src", "generated"), { recursive: true });
  mkdirSync(path.join(pkgDir, "dist", "generated"), { recursive: true });

  writeHostRoot(root);
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { customConditions: ["development"] },
    }),
  );
  writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: "@test/media-core",
      exports: {
        "./iocManifest": {
          development: "./src/generated/ioc-manifest.ts",
          types: "./dist/generated/ioc-manifest.d.ts",
          default: "./dist/generated/ioc-manifest.js",
        },
      },
    }),
  );
  writeFileSync(
    path.join(pkgDir, "src", "generated", "ioc-manifest.ts"),
    `export const iocManifest = { manifestSchemaVersion: 2, moduleImports: [], contracts: {} };`,
  );
  writeFileSync(
    path.join(pkgDir, "dist", "generated", "ioc-manifest.d.ts"),
    `export declare const iocManifest: unknown;`,
  );

  return pkgDir;
};

describe("resolvePackageExportPath", () => {
  describe("When the package uses conditional exports and tsconfig sets customConditions", () => {
    it("should resolve the development source path instead of the types dist path", () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-export-cond-"));
      const pkgDir = writeConditionalExportFixture(root);

      const resolved = resolvePackageExportPath(
        root,
        "@test/media-core",
        "./iocManifest",
        { customConditions: ["development"] },
      );

      assert.strictEqual(
        resolved,
        path.join(pkgDir, "src", "generated", "ioc-manifest.ts"),
      );
    });

    it("should succeed when only the development source exists and dist is absent", () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-export-src-only-"));
      const pkgDir = path.join(root, "node_modules", "@test", "src-only");
      mkdirSync(path.join(pkgDir, "src", "generated"), { recursive: true });
      writeHostRoot(root);
      writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({
          name: "@test/src-only",
          exports: {
            "./iocManifest": {
              development: "./src/generated/ioc-manifest.ts",
              types: "./dist/generated/ioc-manifest.d.ts",
              default: "./dist/generated/ioc-manifest.js",
            },
          },
        }),
      );
      writeFileSync(
        path.join(pkgDir, "src", "generated", "ioc-manifest.ts"),
        `export const iocManifest = { manifestSchemaVersion: 2, moduleImports: [], contracts: {} };`,
      );

      const resolved = resolvePackageExportPath(
        root,
        "@test/src-only",
        "./iocManifest",
        { customConditions: ["development"] },
      );

      assert.strictEqual(
        resolved,
        path.join(pkgDir, "src", "generated", "ioc-manifest.ts"),
      );
    });
  });

  describe("When customConditions do not match any export condition", () => {
    it("should throw listing configured and available conditions", () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-export-staging-"));
      const pkgDir = path.join(root, "node_modules", "@test", "lib");
      mkdirSync(pkgDir, { recursive: true });
      writeHostRoot(root);
      writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({
          name: "@test/lib",
          exports: {
            "./iocManifest": {
              development: "./ioc-manifest.ts",
              types: "./ioc-manifest.d.ts",
            },
          },
        }),
      );
      writeFileSync(
        path.join(pkgDir, "ioc-manifest.ts"),
        `export const iocManifest = { manifestSchemaVersion: 2, moduleImports: [], contracts: {} };`,
      );

      assert.throws(
        () =>
          resolvePackageExportPath(root, "@test/lib", "./iocManifest", {
            customConditions: ["staging"],
          }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /customConditions matched/);
          assert.match(error.message, /"staging"/);
          assert.match(error.message, /Available conditions/);
          assert.match(error.message, /development/);
          assert.doesNotMatch(error.message, /"types"/);
          return true;
        },
      );
    });
  });

  describe("When the export declares a .js path but only the .ts source exists", () => {
    it("should throw file does not exist until .js is mapped to TypeScript source", () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-export-js-src-"));
      const pkgDir = path.join(root, "node_modules", "@test", "js-src");
      mkdirSync(path.join(pkgDir, "src", "generated"), { recursive: true });
      writeHostRoot(root);
      writeFileSync(
        path.join(root, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { customConditions: ["development"] },
        }),
      );
      writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({
          name: "@test/js-src",
          exports: {
            "./iocManifest": {
              development: "./src/generated/ioc-manifest.js",
              types: "./dist/generated/ioc-manifest.d.ts",
              default: "./dist/generated/ioc-manifest.js",
            },
          },
        }),
      );
      writeFileSync(
        path.join(pkgDir, "src", "generated", "ioc-manifest.ts"),
        `export const iocManifest = { manifestSchemaVersion: 2, moduleImports: [], contracts: {} };`,
      );

      assert.throws(
        () =>
          resolvePackageExportPath(root, "@test/js-src", "./iocManifest", {
            customConditions: ["development"],
          }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /file does not exist/);
          assert.match(error.message, /ioc-manifest\.js/);
          return true;
        },
      );
    });
  });

  describe("When the resolved export path does not exist on disk", () => {
    it("should throw an error naming the condition and relative path", () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-export-missing-"));
      const pkgDir = path.join(root, "node_modules", "@test", "missing-src");
      mkdirSync(pkgDir, { recursive: true });
      mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
      writeHostRoot(root);
      writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({
          name: "@test/missing-src",
          exports: {
            "./iocManifest": {
              development: "./src/generated/ioc-manifest.ts",
              default: "./dist/ioc-manifest.js",
            },
          },
        }),
      );
      writeFileSync(
        path.join(pkgDir, "dist", "ioc-manifest.js"),
        `export const iocManifest = {};`,
      );

      assert.throws(
        () =>
          resolvePackageExportPath(root, "@test/missing-src", "./iocManifest", {
            customConditions: ["development"],
          }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /file does not exist/);
          assert.match(error.message, /development/);
          assert.match(error.message, /@test\/missing-src\/iocManifest/);
          assert.doesNotMatch(error.message, /@test\/missing-src\.\//);
          assert.match(error.message, /ioc generate/);
          return true;
        },
      );
    });
  });

  describe("When no customConditions are configured", () => {
    it("should prefer import over default and never select types", () => {
      assert.deepStrictEqual(
        pickExportRelativePath(
          {
            types: "./dist/ioc-manifest.d.ts",
            import: "./src/ioc-manifest.ts",
            default: "./dist/ioc-manifest.js",
          },
          "./iocManifest",
          "@test/pkg",
        ),
        { rel: "./src/ioc-manifest.ts", condition: "import" },
      );
    });

    it("should fall back to default when import is absent", () => {
      assert.deepStrictEqual(
        pickExportRelativePath(
          {
            types: "./dist/ioc-manifest.d.ts",
            default: "./dist/ioc-manifest.js",
          },
          "./iocManifest",
          "@test/pkg",
        ),
        { rel: "./dist/ioc-manifest.js", condition: "default" },
      );
    });
  });

  describe("When the export only declares a types condition", () => {
    it("should throw guidance to add a source-pointing condition", () => {
      assert.throws(
        () =>
          pickExportRelativePath(
            { types: "./dist/ioc-manifest.d.ts" },
            "./iocManifest",
            "@test/types-only",
          ),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /only declares/);
          assert.match(error.message, /types/);
          assert.match(error.message, /development/);
          return true;
        },
      );
    });
  });
});

describe("buildValueLoadConditionOrder", () => {
  describe("When customConditions are omitted or empty", () => {
    it("should use import then default without synthesizing development", () => {
      assert.deepStrictEqual(buildValueLoadConditionOrder(undefined), [
        "import",
        "default",
      ]);
      assert.deepStrictEqual(buildValueLoadConditionOrder([]), [
        "import",
        "default",
      ]);
    });
  });

  describe("When customConditions are declared", () => {
    it("should prepend them in order before import and default", () => {
      assert.deepStrictEqual(
        buildValueLoadConditionOrder(["development", "staging"]),
        ["development", "staging", "import", "default"],
      );
    });
  });
});
