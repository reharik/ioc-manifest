/**
 * Schema v3 `baseTypeId` form: `<packageName>/<path within package>:<TypeName>`. The point of the
 * change is that generated output stops embedding absolute machine paths, so a committed manifest
 * is byte-identical across machines and checkouts.
 */
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  clearPackageRelativePathCache,
  findOwningPackage,
  packageRelativeDeclarationPath,
} from "./packageRelativeDeclarationPath.js";
import { formatCanonicalBaseTypeId } from "./canonicalBaseTypeId.js";

const makePackage = async (
  root: string,
  relDir: string,
  packageName: string,
): Promise<string> => {
  const dir = path.join(root, relDir);
  await fs.mkdir(path.join(dir, "src", "types"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: packageName }),
    "utf8",
  );
  const file = path.join(dir, "src", "types", "Storage.ts");
  await fs.writeFile(file, "export type Storage = { id: string };\n", "utf8");
  return file;
};

describe("packageRelativeDeclarationPath", () => {
  describe("When the declaration file lives inside a named package", () => {
    it("should return the package name joined with the path inside that package", async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "ioc-pkgrel-"));
      clearPackageRelativePathCache();
      const file = await makePackage(root, "packages/storage", "@acme/storage");

      assert.strictEqual(
        packageRelativeDeclarationPath(file),
        "@acme/storage/src/types/Storage.ts",
      );
    });

    it("should contain no absolute path segment from the machine it ran on", async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "ioc-pkgrel-"));
      clearPackageRelativePathCache();
      const file = await makePackage(root, "packages/storage", "@acme/storage");

      const id = formatCanonicalBaseTypeId(file, "Storage");
      assert.strictEqual(id, "@acme/storage/src/types/Storage.ts:Storage");
      assert.ok(!id.includes(root), "id must not embed the checkout location");
      assert.ok(!id.startsWith("/"), "id must not be an absolute path");
    });
  });

  describe("When two packages declare the same type at the same inner path", () => {
    it("should produce distinct ids", async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "ioc-pkgrel-"));
      clearPackageRelativePathCache();
      const a = await makePackage(root, "packages/a", "@acme/a");
      const b = await makePackage(root, "packages/b", "@acme/b");

      assert.notStrictEqual(
        formatCanonicalBaseTypeId(a, "Storage"),
        formatCanonicalBaseTypeId(b, "Storage"),
      );
    });
  });

  describe("When the same package is checked out at two different locations", () => {
    it("should produce the same id from both", async () => {
      const rootA = await fs.mkdtemp(path.join(os.tmpdir(), "ioc-pkgrel-a-"));
      const rootB = await fs.mkdtemp(path.join(os.tmpdir(), "ioc-pkgrel-b-"));
      clearPackageRelativePathCache();
      const fileA = await makePackage(rootA, "packages/storage", "@acme/storage");
      const fileB = await makePackage(rootB, "elsewhere/storage", "@acme/storage");

      assert.strictEqual(
        formatCanonicalBaseTypeId(fileA, "Storage"),
        formatCanonicalBaseTypeId(fileB, "Storage"),
      );
    });
  });

  describe("When a nested package.json sits between the file and the workspace root", () => {
    it("should attribute the file to the nearest enclosing package", async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "ioc-pkgrel-"));
      clearPackageRelativePathCache();
      await fs.writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ name: "workspace-root" }),
        "utf8",
      );
      const file = await makePackage(root, "packages/inner", "@acme/inner");

      const owner = findOwningPackage(file);
      assert.strictEqual(owner?.packageName, "@acme/inner");
      assert.strictEqual(
        packageRelativeDeclarationPath(file),
        "@acme/inner/src/types/Storage.ts",
      );
    });
  });
});
