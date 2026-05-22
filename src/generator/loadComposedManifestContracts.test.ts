import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { loadComposedManifestContractNames } from "./loadComposedManifestContracts.js";

describe("loadComposedManifestContractNames", () => {
  describe("When a package exports iocManifest with contracts", () => {
    it("should collect contract names from the generated manifest source", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-composed-contracts-"));
      const pkgDir = path.join(root, "node_modules", "@test", "lib-a");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "test-host", type: "module" }),
      );
      writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({
          name: "@test/lib-a",
          exports: { "./iocManifest": "./ioc-manifest.ts" },
        }),
      );
      writeFileSync(
        path.join(pkgDir, "ioc-manifest.ts"),
        `export const iocManifest = {
  manifestSchemaVersion: 1,
  moduleImports: [],
  contracts: {
    Storage: { localStorage: {} },
    UploadService: { uploadService: {} },
  },
};`,
      );

      const result = await loadComposedManifestContractNames(root, ["@test/lib-a"]);
      assert.deepStrictEqual(
        Array.from(result.all).sort((a, b) => a.localeCompare(b)),
        ["Storage", "UploadService"],
      );
      assert.deepStrictEqual(
        Array.from(result.byPackage.get("@test/lib-a") ?? []).sort((a, b) =>
          a.localeCompare(b),
        ),
        ["Storage", "UploadService"],
      );
    });
  });
});
