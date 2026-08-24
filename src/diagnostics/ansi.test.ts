/**
 * Colour precedence, and the reason `npm test` pins `NO_COLOR=1`.
 *
 * The bug this file exists to prevent shipped once already: two renderers were given an ambient
 * default (colour when stdout is a TTY), and two tests asserted their plain-text layout without
 * saying so. The suite passed in CI and in any piped run, and failed the moment someone ran
 * `npm test` in a terminal — which is the worst shape a test failure can have, because the machine
 * that reports green is not the machine the developer is looking at.
 *
 * Two things keep it fixed. The test script pins `NO_COLOR=1`, so the suite's ambient answer is the
 * same everywhere; and a test asserting rendered text passes `color: false` explicitly, so it says
 * what it depends on. An explicit `color` argument outranks the environment either way, so pinning
 * the environment masks nothing: a test that wants colour asks for it and gets it.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ansi, resolveAnsi, shouldColorize } from "./ansi.js";

const ESC = "\u001b";

/** Restores whatever the ambient environment actually was, so ordering cannot leak between tests. */
const saved = {
  noColor: process.env.NO_COLOR,
  forceColor: process.env.FORCE_COLOR,
  isTTY: process.stdout.isTTY,
};

const setEnv = (name: "NO_COLOR" | "FORCE_COLOR", value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

afterEach(() => {
  setEnv("NO_COLOR", saved.noColor);
  setEnv("FORCE_COLOR", saved.forceColor);
  process.stdout.isTTY = saved.isTTY;
});

describe("shouldColorize", () => {
  describe("When NO_COLOR is set", () => {
    it("should stay plain even against FORCE_COLOR and a TTY", () => {
      setEnv("NO_COLOR", "1");
      setEnv("FORCE_COLOR", "1");
      process.stdout.isTTY = true;

      // NO_COLOR wins outright. This is what makes `NO_COLOR=1` in the test script a hard pin
      // rather than a default a developer's exported FORCE_COLOR could undo.
      assert.equal(shouldColorize(), false);
    });
  });

  describe("When FORCE_COLOR is set and NO_COLOR is not", () => {
    it("should colorize even without a TTY", () => {
      setEnv("NO_COLOR", undefined);
      setEnv("FORCE_COLOR", "1");
      process.stdout.isTTY = false;

      assert.equal(shouldColorize(), true);
    });

    it("should treat an empty FORCE_COLOR as not set", () => {
      // The shape a CI expression leaves when it resolves to nothing. Reading it as "force" would
      // put escapes into every piped log in the job, which is the opposite of what was asked for.
      setEnv("NO_COLOR", undefined);
      setEnv("FORCE_COLOR", "");
      process.stdout.isTTY = false;

      assert.equal(shouldColorize(), false);
    });

    it("should treat FORCE_COLOR=0 as not set", () => {
      setEnv("NO_COLOR", undefined);
      setEnv("FORCE_COLOR", "0");
      process.stdout.isTTY = false;

      assert.equal(shouldColorize(), false);
    });
  });

  describe("When neither variable is set", () => {
    it("should follow whether stdout is a TTY", () => {
      setEnv("NO_COLOR", undefined);
      setEnv("FORCE_COLOR", undefined);

      process.stdout.isTTY = true;
      assert.equal(shouldColorize(), true);

      process.stdout.isTTY = false;
      assert.equal(shouldColorize(), false);
    });
  });
});

describe("resolveAnsi", () => {
  describe("When a caller passes an explicit choice", () => {
    it("should outrank the environment in both directions", () => {
      setEnv("NO_COLOR", "1");
      process.stdout.isTTY = false;
      assert.equal(resolveAnsi(true).red, ansi(true).red);

      setEnv("NO_COLOR", undefined);
      setEnv("FORCE_COLOR", "1");
      assert.equal(resolveAnsi(false).red, "");
    });
  });

  describe("When colour is disabled", () => {
    it("should make every escape the empty string, so plain output is byte-stable", () => {
      const off = ansi(false);

      assert.deepEqual(
        Object.values(off),
        Object.keys(off).map(() => ""),
      );
      assert.ok(Object.values(ansi(true)).every((code) => code.startsWith(ESC)));
    });
  });
});
