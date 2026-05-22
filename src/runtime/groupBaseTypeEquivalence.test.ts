import assert from "node:assert";
import { describe, it } from "node:test";
import { areCanonicalBaseTypeIdsEquivalent } from "./groupBaseTypeEquivalence.js";

describe("areCanonicalBaseTypeIdsEquivalent", () => {
  describe("When ids are identical", () => {
    it("should return true without alias sets", () => {
      assert.strictEqual(
        areCanonicalBaseTypeIdsEquivalent("/a.ts:Foo", "/a.ts:Foo", "g", undefined),
        true,
      );
    });
  });

  describe("When ids differ but appear in the same alias set for the group", () => {
    it("should return true", () => {
      assert.strictEqual(
        areCanonicalBaseTypeIdsEquivalent(
          "/a.ts:Foo",
          "/b.ts:Foo",
          "discountStrategies",
          {
            discountStrategies: ["/a.ts:Foo", "/b.ts:Foo"],
          },
        ),
        true,
      );
    });
  });

  describe("When ids differ and no alias set matches", () => {
    it("should return false", () => {
      assert.strictEqual(
        areCanonicalBaseTypeIdsEquivalent(
          "/a.ts:Foo",
          "/b.ts:Foo",
          "otherGroup",
          {
            discountStrategies: ["/a.ts:Foo", "/b.ts:Foo"],
          },
        ),
        false,
      );
    });
  });
});
