import assert from "node:assert";
import { describe, it } from "node:test";
import { mergeFrameSequences } from "./iocResolutionError.js";

describe("mergeFrameSequences", () => {
  describe("When merging ancestor stacks with existing frames", () => {
    it("should return existing when ancestor is a full prefix by registration key", () => {
      const ancestor = [
        { contractName: "A", registrationKey: "a" },
        { contractName: "B", registrationKey: "b" },
      ];
      const existing = [
        { contractName: "A", registrationKey: "a" },
        { contractName: "B", registrationKey: "b" },
        { contractName: "C", registrationKey: "c" },
      ];
      const merged = mergeFrameSequences(ancestor, existing);
      assert.deepStrictEqual(merged, existing);
    });

    it("should prepend ancestors when the first existing frame does not match", () => {
      const ancestor = [{ contractName: "Root", registrationKey: "root" }];
      const existing = [
        { contractName: "LevelA", registrationKey: "levelA" },
        { contractName: "LevelB", registrationKey: "levelB" },
      ];
      const merged = mergeFrameSequences(ancestor, existing);
      assert.deepStrictEqual(merged, [
        { contractName: "Root", registrationKey: "root" },
        { contractName: "LevelA", registrationKey: "levelA" },
        { contractName: "LevelB", registrationKey: "levelB" },
      ]);
    });
  });
});
