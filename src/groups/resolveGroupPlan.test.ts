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
    it("should map members to an object keyed by contract key", () => {
      const plan: GroupPlan = {
        groupName: "g",
        kind: "object",
        baseType: "Base",
        members: [
          {
            contractKey: "albumReadService",
            contractName: "AlbumReadService",
            registrationKey: "albumReadService",
          },
          {
            contractKey: "userReadService",
            contractName: "UserReadService",
            registrationKey: "userReadService",
          },
        ],
      };
      assert.deepStrictEqual(groupPlanToManifestNode(plan), {
        albumReadService: {
          contractName: "AlbumReadService",
          registrationKey: "albumReadService",
        },
        userReadService: {
          contractName: "UserReadService",
          registrationKey: "userReadService",
        },
      });
    });

    it("should use contract key as property name when default uses a different registration key", () => {
      const plan: GroupPlan = {
        groupName: "g",
        kind: "object",
        baseType: "Base",
        members: [
          {
            contractKey: "albumReadService",
            contractName: "AlbumReadService",
            registrationKey: "primaryAlbumReadService",
          },
        ],
      };
      assert.deepStrictEqual(groupPlanToManifestNode(plan), {
        albumReadService: {
          contractName: "AlbumReadService",
          registrationKey: "primaryAlbumReadService",
        },
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

  describe("When issue is group_duplicate_contract_key", () => {
    it("should mention the duplicate contract key", () => {
      const msg = formatGroupPlanIssue({
        kind: "group_duplicate_contract_key",
        groupName: "dup",
        contractKey: "same",
      });
      assert.ok(msg.includes("same"));
      assert.ok(msg.includes("duplicate"));
    });
  });

  describe("When issue is group_root_key_reserved_manifest", () => {
    it("should mention the reserved key and generated manifest", () => {
      const msg = formatGroupPlanIssue({
        kind: "group_root_key_reserved_manifest",
        key: "contracts",
      });
      assert.ok(msg.includes("contracts"));
      assert.ok(msg.includes("reserved"));
    });
  });
});
