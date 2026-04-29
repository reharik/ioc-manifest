import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveDiscoveryRootDefaultLifetime } from "./manifestPaths.js";

describe("resolveDiscoveryRootDefaultLifetime", () => {
  describe("When duplicate discovery roots target the same directory with conflicting scope", () => {
    it("should throw a validation error", () => {
      const root = path.normalize("/proj/src");
      const file = path.join(root, "f.ts");
      assert.throws(
        () =>
          resolveDiscoveryRootDefaultLifetime(file, [
            { absPath: root, scope: "singleton" },
            { absPath: root, scope: "transient" },
          ]),
        /conflicting scope values/,
      );
    });
  });
});
