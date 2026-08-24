/**
 * @fileoverview One module owns tsx. This is the test that keeps it that way.
 *
 * The 156-second field regression was not caused by a wrong line; it was caused by the RIGHT line
 * being in four places. `loadIocConfig` reached for `tsImport` directly, so every caller that
 * wanted a config silently bought another ESM hook, and no reviewer looking at any single call site
 * could see the cost — it only existed in the aggregate.
 *
 * Centralising the loader fixes today's instance. This test is what stops tomorrow's: a second
 * module anywhere under `src` reaching for the tsx loader API directly fails here, with the reason
 * attached, before it can reintroduce per-load registration from a new direction.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The single module permitted to import tsx, relative to `src`. */
const LOADER = path.join("config", "configModuleLoader.ts");

const IMPORTS_TSX = /(?:from|import)\s*\(?\s*["'](tsx(?:\/[^"']*)?)["']/;

const listTypeScriptFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Fixtures are inert sample sources, not shipped code paths.
      if (entry.name === "node_modules" || entry.name === "test-fixtures") {
        continue;
      }
      found.push(...(await listTypeScriptFiles(full)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
};

describe("config loader isolation", () => {
  describe("When any module under src imports tsx", () => {
    it("should be configModuleLoader and nothing else", async () => {
      const files = await listTypeScriptFiles(SRC_ROOT);
      assert.ok(files.length > 50, "the source sweep should have found the codebase");

      const offenders = files
        .map((file) => ({ file, rel: path.relative(SRC_ROOT, file) }))
        .filter(({ rel }) => rel !== LOADER)
        .filter(({ file }) => IMPORTS_TSX.test(readFileSync(file, "utf8")))
        .map(({ rel }) => rel);

      assert.deepEqual(
        offenders,
        [],
        `only ${LOADER} may import tsx — every other config load must go through ` +
          `importConfigModule(), so the process holds exactly one ESM hook. Offenders: ` +
          offenders.join(", "),
      );
    });

    it("should be an import the loader actually still has", async () => {
      // Guards the guard: if the loader stops importing tsx, the sweep above passes vacuously.
      const loaderSource = readFileSync(path.join(SRC_ROOT, LOADER), "utf8");
      assert.match(loaderSource, IMPORTS_TSX);
    });
  });
});
