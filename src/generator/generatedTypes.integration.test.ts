import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const typesPath = path.join(__dirname, "../generated/ioc-registry.types.ts");

describe("ioc-registry.types.ts (generated)", () => {
  describe("When MediaStorage is implemented in multiple modules", () => {
    it("should import the MediaStorage type from the module that declares it, not from an arbitrary default implementation file", () => {
      const source = fs.readFileSync(typesPath, "utf8");
      assert.match(
        source,
        /import type \{[\s\S]*\bMediaStorage\b[\s\S]*\} from "\.\.\/examples\/b-multiple-implementations\.js"/,
      );
      assert.ok(
        !source.includes(
          'import type { MediaStorage } from "../examples/c-default-selection.js"',
        ),
      );
    });
  });
});
