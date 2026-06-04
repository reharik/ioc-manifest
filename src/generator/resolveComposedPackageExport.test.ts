import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { resolvePackageExportPath } from "./resolveComposedPackageExport.js";

const writeConditionalExportFixture = (root: string): string => {
  const pkgDir = path.join(root, "node_modules", "@test", "media-core");
  mkdirSync(pkgDir, { recursive: true });
  mkdirSync(path.join(pkgDir, "src", "generated"), { recursive: true });
  mkdirSync(path.join(pkgDir, "dist", "generated"), { recursive: true });

  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "test-host", type: "module" }),
  );
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
  });
});
