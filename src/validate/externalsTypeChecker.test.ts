import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createValidateTypeChecker } from "./externalsTypeChecker.js";

describe("createValidateTypeChecker", () => {
  describe("When tsconfig declares customConditions", () => {
    it("should carry customConditions in the checker context for module resolution parity", () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-validate-checker-"));
      writeFileSync(
        path.join(root, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            customConditions: ["development"],
          },
        }),
      );
      const typesPath = path.join(root, "types.ts");
      writeFileSync(
        typesPath,
        "export interface IocGeneratedCradle { config: { logLevel: string } }\n",
      );

      const ctx = createValidateTypeChecker(root, [typesPath]);
      assert.ok(ctx !== undefined);
      assert.deepEqual(ctx!.customConditions, ["development"]);
    });
  });
});
