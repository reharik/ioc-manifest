import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import ts from "typescript";
import {
  formatDiscoveryProgramErrorDiagnostics,
  getDiscoveryTargetFiles,
  isCodegenFailureCausedByTypeScript,
} from "./iocProgramContext.js";
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

describe("formatDiscoveryProgramErrorDiagnostics", () => {
  describe("When a discovery file has a TypeScript error", () => {
    it("should include that file in the formatted output", () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ioc-ts-diag-"));
      const badPath = path.join(tmp, "bad.ts");
      fs.writeFileSync(badPath, 'const x: number = "nope";');

      const program = ts.createProgram({
        rootNames: [badPath],
        options: { strict: true },
      });

      const formatted = formatDiscoveryProgramErrorDiagnostics(
        program,
        tmp,
        [badPath],
      );

      assert.ok(formatted.length > 0);
      assert.match(formatted, /bad\.ts/);
    });
  });

  describe("When errors exist only outside discovery root names", () => {
    it("should return an empty string", () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ioc-ts-diag-"));
      const badPath = path.join(tmp, "bad.ts");
      const otherPath = path.join(tmp, "other.ts");
      fs.writeFileSync(badPath, 'const x: number = "nope";');
      fs.writeFileSync(otherPath, "export const ok = 1;");

      const program = ts.createProgram({
        rootNames: [badPath, otherPath],
        options: { strict: true },
      });

      const formatted = formatDiscoveryProgramErrorDiagnostics(
        program,
        tmp,
        [otherPath],
      );

      assert.equal(formatted, "");
    });
  });
});

describe("isCodegenFailureCausedByTypeScript", () => {
  describe("When codegen failed due to type checking", () => {
    it("should return true for file-not-in-program errors", () => {
      assert.equal(
        isCodegenFailureCausedByTypeScript(
          new Error(
            '[ioc] File is not in the TypeScript program (cannot type-check): "src/foo.ts".',
          ),
        ),
        true,
      );
    });

    it("should return true for unresolvable deps type errors", () => {
      assert.equal(
        isCodegenFailureCausedByTypeScript(
          new Error(
            '[ioc] Factory "buildFoo" at src/foo.ts:1 references an unresolvable type in deps for property "bar": unknown',
          ),
        ),
        true,
      );
    });
  });

  describe("When codegen failed for non-type reasons", () => {
    it("should return false for duplicate registration key errors", () => {
      assert.equal(
        isCodegenFailureCausedByTypeScript(
          new Error('[ioc] Duplicate registration key "foo".'),
        ),
        false,
      );
    });

    it("should return false for ioc-config validation errors", () => {
      assert.equal(
        isCodegenFailureCausedByTypeScript(
          new Error(
            "[ioc-config] registrations references unknown contract \"Missing\".",
          ),
        ),
        false,
      );
    });
  });
});
