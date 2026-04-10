import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { getDiscoveryTargetFiles } from "./iocProgramContext.js";
import { resolveManifestOptions } from "./manifestOptions.js";
import { resolveScanDirEntries } from "./manifestPaths.js";

describe("getDiscoveryTargetFiles", () => {
  describe("When default exclude patterns are applied", () => {
    it("should omit *.test.ts, *.tests.ts, *.spec.ts, and *.specs.ts from discovery targets", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ioc-discovery-glob-"));
      fs.writeFileSync(path.join(tmp, "keep.ts"), "");
      fs.writeFileSync(path.join(tmp, "drop.test.ts"), "");
      fs.writeFileSync(path.join(tmp, "drop.tests.ts"), "");
      fs.writeFileSync(path.join(tmp, "drop.spec.ts"), "");
      fs.writeFileSync(path.join(tmp, "drop.specs.ts"), "");
      fs.mkdirSync(path.join(tmp, "nested"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "nested", "also.tests.ts"), "");

      const { excludePatterns } = resolveManifestOptions();
      const scanDirs = resolveScanDirEntries(tmp, [{ path: "." }]);
      const generatedDir = path.join(tmp, "generated");

      const files = await getDiscoveryTargetFiles(
        scanDirs,
        ["**/*.{ts,tsx}"],
        excludePatterns,
        generatedDir,
      );

      assert.deepStrictEqual(
        files.map((f) => path.basename(f)).sort(),
        ["keep.ts"],
      );
    });
  });
});
