import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDiscoveryScanDirs } from "./parseDiscoveryScanDirs.js";

describe("parseDiscoveryScanDirs", () => {
  describe("When scanDirs is a single non-empty string", () => {
    it("should normalize to one spec with that path", () => {
      assert.deepStrictEqual(parseDiscoveryScanDirs("src", "cfg"), [
        { path: "src" },
      ]);
    });
  });

  describe("When scanDirs is a non-empty string array", () => {
    it("should map each string to a path-only spec", () => {
      assert.deepStrictEqual(parseDiscoveryScanDirs(["a", "b"], "cfg"), [
        { path: "a" },
        { path: "b" },
      ]);
    });
  });

  describe("When scanDirs mixes plain strings and object entries", () => {
    it("should normalize each element in order", () => {
      assert.deepStrictEqual(
        parseDiscoveryScanDirs(
          [
            "src",
            {
              path: "../../packages/x",
              importPrefix: "@scope/x",
              importMode: "root",
            },
          ],
          "cfg",
        ),
        [
          { path: "src" },
          {
            path: "../../packages/x",
            importPrefix: "@scope/x",
            importMode: "root",
          },
        ],
      );
    });
  });

  describe("When scanDirs is an object array with importPrefix and importMode", () => {
    it("should preserve path, importPrefix, and importMode", () => {
      assert.deepStrictEqual(
        parseDiscoveryScanDirs(
          [
            {
              path: "../../packages/x",
              importPrefix: "@scope/x",
              importMode: "subpath",
            },
          ],
          "cfg",
        ),
        [
          {
            path: "../../packages/x",
            importPrefix: "@scope/x",
            importMode: "subpath",
          },
        ],
      );
    });
  });

  describe("When an object has importMode without importPrefix", () => {
    it('should throw when importMode is "root"', () => {
      assert.throws(
        () =>
          parseDiscoveryScanDirs(
            [{ path: "src", importMode: "root" }] as never,
            "cfg",
          ),
        /importMode cannot be set to "root" without importPrefix/,
      );
    });
  });

  describe("When an object has importPrefix without importMode", () => {
    it("should throw a clear config error", () => {
      assert.throws(
        () =>
          parseDiscoveryScanDirs(
            [{ path: "src", importPrefix: "@x" }] as never,
            "cfg",
          ),
        /importMode must be "root" or "subpath" when importPrefix is set/,
      );
    });
  });

  describe("When scanDirs is an empty array", () => {
    it("should throw", () => {
      assert.throws(() => parseDiscoveryScanDirs([], "cfg"), /non-empty/);
    });
  });
});
