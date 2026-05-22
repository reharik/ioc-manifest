import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findPackageIdentifierCollisions,
  packageNameToIdentifier,
} from "./packageIdentifier.js";

describe("packageNameToIdentifier", () => {
  describe("When the package name includes a scope", () => {
    it("should strip the scope and camelCase the remainder", () => {
      assert.equal(
        packageNameToIdentifier("@packages/media-core"),
        "mediaCore",
      );
    });
  });

  describe("When separators are mixed", () => {
    it("should camelCase across hyphens underscores dots and slashes", () => {
      assert.equal(packageNameToIdentifier("foo_bar.baz/qux"), "fooBarBazQux");
    });
  });
});

describe("findPackageIdentifierCollisions", () => {
  describe("When two scoped packages share the same unscoped name", () => {
    it("should report a collision", () => {
      const collisions = findPackageIdentifierCollisions([
        "@a/media-core",
        "@b/media-core",
      ]);
      assert.equal(collisions.length, 1);
      assert.equal(collisions[0]!.identifier, "mediaCore");
      assert.deepEqual(collisions[0]!.packages, [
        "@a/media-core",
        "@b/media-core",
      ]);
    });
  });

  describe("When a composed package maps to the reserved local identifier", () => {
    it("should report a collision", () => {
      const collisions = findPackageIdentifierCollisions(["local"]);
      assert.equal(collisions.length, 1);
      assert.equal(collisions[0]!.identifier, "local");
    });
  });
});
