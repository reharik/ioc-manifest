import assert from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { defineIocConfig } from "../config/iocConfig.js";
import {
  mergeManifestOptionsWithIocConfig,
  resolveManifestOptions,
} from "./manifestOptions.js";

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

  describe("When mergeManifestOptionsWithIocConfig runs", () => {
    it("should preserve base paths.workspacePackageImportBases when discovery.workspacePackageImportBases is omitted", () => {
      const base = resolveManifestOptions({
        paths: {
          projectRoot: path.join(path.sep, "repo", "apps", "web"),
          workspacePackageImportBases: [
            {
              absRoot: path.join(path.sep, "repo", "packages", "lib", "src"),
              importBase: "@acme/lib",
            },
          ],
        },
      });
      const config = defineIocConfig({
        discovery: {
          scanDirs: "src",
        },
      });
      const merged = mergeManifestOptionsWithIocConfig(base, config);
      assert.deepStrictEqual(merged.paths.workspacePackageImportBases, [
        {
          absRoot: path.join(path.sep, "repo", "packages", "lib", "src"),
          importBase: "@acme/lib",
        },
      ]);
    });
  });
});
