import assert from "node:assert";
import { describe, it } from "node:test";
import {
  formatGroupPlanIssue,
  groupPlanToManifestNode,
  type GroupPlan,
} from "./resolveGroupPlan.js";

describe("groupPlanToManifestNode", () => {
  describe("When kind is collection", () => {
    it("should map members to a leaf array in registration key order", () => {
      const plan: GroupPlan = {
        groupName: "g",
        kind: "collection",
        baseType: "Base",
        members: [
          { contractName: "B", registrationKey: "b" },
          { contractName: "A", registrationKey: "a" },
        ],
      };
      assert.deepStrictEqual(groupPlanToManifestNode(plan), [
        { contractName: "B", registrationKey: "b" },
        { contractName: "A", registrationKey: "a" },
      ]);
    });
  });

  describe("When kind is object", () => {
    it("should map members to an object keyed by registration key", () => {
      const plan: GroupPlan = {
        groupName: "g",
        kind: "object",
        baseType: "Base",
        members: [
          { contractName: "A", registrationKey: "aImpl" },
          { contractName: "B", registrationKey: "bImpl" },
        ],
      };
      assert.deepStrictEqual(groupPlanToManifestNode(plan), {
        aImpl: { contractName: "A", registrationKey: "aImpl" },
        bImpl: { contractName: "B", registrationKey: "bImpl" },
      });
    });
  });
});

describe("formatGroupPlanIssue", () => {
  describe("When issue is group_no_matches", () => {
    it("should mention the group name and base type", () => {
      const msg = formatGroupPlanIssue({
        kind: "group_no_matches",
        groupName: "empty",
        baseType: "NoSuch",
      });
      assert.ok(msg.includes("empty"));
      assert.ok(msg.includes("NoSuch"));
    });
  });

  describe("When issue is group_duplicate_registration_key", () => {
    it("should mention the duplicate key", () => {
      const msg = formatGroupPlanIssue({
        kind: "group_duplicate_registration_key",
        groupName: "dup",
        registrationKey: "same",
      });
      assert.ok(msg.includes("same"));
      assert.ok(msg.includes("duplicate"));
    });
  });
});
