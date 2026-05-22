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
          ["src", { path: "lib", scope: "singleton" }],
          "cfg",
        ),
        [{ path: "src" }, { path: "lib", scope: "singleton" }],
      );
    });
  });

  describe("When an object sets importPrefix", () => {
    it("should throw a v2 removal error", () => {
      assert.throws(
        () =>
          parseDiscoveryScanDirs(
            [{ path: "src", importPrefix: "@x" }] as never,
            "cfg",
          ),
        /importPrefix was removed in v2/,
      );
    });
  });

  describe("When an object sets importMode", () => {
    it("should throw a v2 removal error", () => {
      assert.throws(
        () =>
          parseDiscoveryScanDirs(
            [{ path: "src", importMode: "subpath" }] as never,
            "cfg",
          ),
        /importMode was removed in v2/,
      );
    });
  });

  describe("When scanDirs is an empty array", () => {
    it("should throw", () => {
      assert.throws(() => parseDiscoveryScanDirs([], "cfg"), /non-empty/);
    });
  });

  describe("When an object sets scope", () => {
    it("should preserve a valid scope value", () => {
      assert.deepStrictEqual(
        parseDiscoveryScanDirs([{ path: "src", scope: "scoped" }], "cfg"),
        [{ path: "src", scope: "scoped" }],
      );
    });

    it("should throw when scope is invalid", () => {
      assert.throws(
        () =>
          parseDiscoveryScanDirs([{ path: "src", scope: "bogus" }] as never, "cfg"),
        /\.scope must be singleton/,
      );
    });
  });
});
