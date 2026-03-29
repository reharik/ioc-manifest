import assert from "node:assert";
import { describe, it } from "node:test";
import type {
  ResolvedContractRegistration,
  ResolvedImplementationEntry,
} from "../generator/resolveRegistrationPlan.js";
import { shouldIncludeImplInCollectionGroup } from "./baseTypeAssignability.js";

const minimalImpl = (
  implementationName: string,
  registrationKey: string,
): ResolvedImplementationEntry => ({
  implementationName,
  registrationKey,
  exportName: "buildX",
  modulePath: "m.ts",
  relImport: "../m.js",
  lifetime: "singleton",
});

describe("shouldIncludeImplInCollectionGroup", () => {
  describe("When an implementation uses the contract default registration key but is not the selected default implementation", () => {
    it("should exclude it from collection membership", () => {
      const plan: ResolvedContractRegistration = {
        contractName: "MediaStorage",
        contractTypeRelImport: "../x.js",
        contractKey: "mediaStorage",
        accessKey: "mediaStorage",
        collectionKey: "mediaStorages",
        defaultImplementationName: "s3MediaStorage",
        implementations: [
          minimalImpl("localMediaStorage", "localMediaStorage"),
          minimalImpl("mediaStorage", "mediaStorage"),
          minimalImpl("s3MediaStorage", "s3MediaStorage"),
        ],
      };
      assert.strictEqual(
        shouldIncludeImplInCollectionGroup(plan, plan.implementations[0]!),
        true,
      );
      assert.strictEqual(
        shouldIncludeImplInCollectionGroup(plan, plan.implementations[1]!),
        false,
      );
      assert.strictEqual(
        shouldIncludeImplInCollectionGroup(plan, plan.implementations[2]!),
        true,
      );
    });
  });

  describe("When the selected default is registered at the contract default key", () => {
    it("should include that implementation", () => {
      const plan: ResolvedContractRegistration = {
        contractName: "MediaStorage",
        contractTypeRelImport: "../x.js",
        contractKey: "mediaStorage",
        accessKey: "mediaStorage",
        collectionKey: "mediaStorages",
        defaultImplementationName: "mediaStorage",
        implementations: [
          minimalImpl("localMediaStorage", "localMediaStorage"),
          minimalImpl("mediaStorage", "mediaStorage"),
        ],
      };
      assert.strictEqual(
        shouldIncludeImplInCollectionGroup(plan, plan.implementations[1]!),
        true,
      );
    });
  });

  describe("When the implementation uses a registration key other than the contract default key", () => {
    it("should include it regardless of default selection", () => {
      const plan: ResolvedContractRegistration = {
        contractName: "MediaStorage",
        contractTypeRelImport: "../x.js",
        contractKey: "mediaStorage",
        accessKey: "mediaStorage",
        collectionKey: "mediaStorages",
        defaultImplementationName: "s3MediaStorage",
        implementations: [minimalImpl("localMediaStorage", "localMediaStorage")],
      };
      assert.strictEqual(
        shouldIncludeImplInCollectionGroup(plan, plan.implementations[0]!),
        true,
      );
    });
  });
});
