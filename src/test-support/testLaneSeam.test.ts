/**
 * @fileoverview The seam that keeps `npm run test:fast` fast, enforced instead of remembered.
 *
 * `test:fast` runs the non-`.integration` glob. That is worth having only while the suffix is
 * true, and a suffix nobody checks is the hand-maintained list of slow files it replaced, wearing a
 * different hat. So the suffix is checked, in both directions, by mechanism:
 *
 *  - a fast-lane file that builds a TypeScript program, spawns a subprocess, or runs codegen is a
 *    file that will make the fast lane slow, and must carry the suffix;
 *  - a `.integration` file that does none of those is paying the suffix for nothing, and is
 *    withholding coverage from the lane developers actually iterate on.
 *
 * Both failures were live in this repo when the lanes were introduced, in both directions and in
 * bulk: 34 files did integration work without the suffix — `generatedReferenceForms.test.ts`, the
 * slowest file in the repo at 18 seconds, among them — and one carried the suffix for a 0.3-second
 * file read.
 *
 * The rule itself, and why it is static rather than timed, is in {@link ./testLaneSeam.ts}.
 *
 * This file is in the fast lane and must stay there — which is also the neatest demonstration that
 * the rule distinguishes reaching for the compiler from merely importing it: it imports
 * `typescript` to parse every test file in the repo, and never builds a program.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  collectTestFiles,
  integrationMechanismsOf,
} from "./testLaneSeam.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(__dirname, "..");

const rel = (file: string): string => path.relative(srcRoot, file);

const lanes = collectTestFiles(srcRoot);

describe("the fast-lane seam", () => {
  describe("When a test file carries no `.integration` suffix", () => {
    it("should build no TypeScript program, spawn no subprocess, and run no codegen", () => {
      const offenders = lanes.fast
        .map((file) => ({
          file: rel(file),
          reasons: integrationMechanismsOf(file, srcRoot),
        }))
        .filter((entry) => entry.reasons.length > 0);

      assert.deepEqual(
        offenders,
        [],
        `these files do integration work but run in \`npm run test:fast\`. Rename each to \`*.integration.test.ts\`:\n${offenders
          .map((entry) => `  ${entry.file}\n    - ${entry.reasons.join("\n    - ")}`)
          .join("\n")}`,
      );
    });
  });

  describe("When a test file carries the `.integration` suffix", () => {
    it("should actually do integration work, so the suffix is not withholding coverage", () => {
      const liars = lanes.integration
        .filter((file) => integrationMechanismsOf(file, srcRoot).length === 0)
        .map(rel);

      assert.deepEqual(
        liars,
        [],
        `these files build no program, spawn nothing and generate nothing, but are excluded from \`npm run test:fast\`. Drop the \`.integration\` from each name:\n${liars
          .map((file) => `  ${file}`)
          .join("\n")}`,
      );
    });
  });

  describe("When the lanes are enumerated", () => {
    it("should find both of them non-empty, so a broken glob cannot pass silently", () => {
      // An enumeration bug that returned nothing would make both assertions above vacuous.
      assert.ok(
        lanes.fast.length > 0,
        "no fast-lane test files found — the enumeration is broken, not the repo",
      );
      assert.ok(
        lanes.integration.length > 0,
        "no integration test files found — the enumeration is broken, not the repo",
      );
    });
  });
});
