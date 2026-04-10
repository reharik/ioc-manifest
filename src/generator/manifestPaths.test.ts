import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { computeManifestModuleSpecifier } from "./manifestPaths.js";

describe("computeManifestModuleSpecifier", () => {
  describe("When the file is under a scan dir with importMode root", () => {
    it("should return the import prefix only", () => {
      const projectRoot = path.join(path.sep, "proj", "app");
      const pkgRoot = path.join(projectRoot, "packages", "lib");
      const file = path.join(pkgRoot, "src", "repo.ts");
      const generatedDir = path.join(projectRoot, "generated");
      const scanDirs = [
        {
          absPath: pkgRoot,
          importPrefix: "@acme/lib",
          importMode: "root" as const,
        },
      ];
      assert.strictEqual(
        computeManifestModuleSpecifier(file, generatedDir, scanDirs),
        "@acme/lib",
      );
    });
  });

  describe("When the file is under a scan dir with importMode subpath", () => {
    it("should return prefix plus posix path from scan root without extension plus .js", () => {
      const projectRoot = path.join(path.sep, "proj", "app");
      const pkgRoot = path.join(projectRoot, "packages", "lib");
      const file = path.join(pkgRoot, "src", "repositories", "repo.ts");
      const generatedDir = path.join(projectRoot, "generated");
      const scanDirs = [
        {
          absPath: pkgRoot,
          importPrefix: "@acme/lib",
          importMode: "subpath" as const,
        },
      ];
      assert.strictEqual(
        computeManifestModuleSpecifier(file, generatedDir, scanDirs),
        "@acme/lib/src/repositories/repo.js",
      );
    });
  });

  describe("When the file is only matched by a local scan dir without importPrefix", () => {
    it("should emit a relative specifier from generatedDir", () => {
      const projectRoot = path.join(path.sep, "proj", "app");
      const srcRoot = path.join(projectRoot, "src");
      const file = path.join(srcRoot, "svc", "buildThing.ts");
      const generatedDir = path.join(projectRoot, "src", "generated");
      const scanDirs = [{ absPath: srcRoot }];
      assert.strictEqual(
        computeManifestModuleSpecifier(file, generatedDir, scanDirs),
        "../svc/buildThing.js",
      );
    });
  });
});
