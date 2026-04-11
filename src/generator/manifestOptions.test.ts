import assert from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveManifestOptions } from "./manifestOptions.js";

describe("resolveManifestOptions", () => {
  describe("When paths override includes scanDirs as undefined", () => {
    it("should keep the default scanDirs instead of clearing it", () => {
      const cwd = process.cwd();
      const resolved = resolveManifestOptions({
        paths: {
          scanDirs: undefined,
        },
      });
      assert.ok(resolved.paths.scanDirs.length > 0);
      assert.strictEqual(
        path.normalize(resolved.paths.scanDirs[0]!.absPath),
        path.normalize(path.join(cwd, "src")),
      );
    });
  });
});
