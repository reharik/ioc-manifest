import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IocConfig } from "../config/iocConfig.js";
import type {
  IocGroupNodeManifest,
  IocGroupRootManifest,
  IocGroupsManifest,
} from "../core/manifest.js";
import { validateNonEmptyGroupsAtCodegen } from "./validateNonEmptyGroupsAtCodegen.js";

const makeRoot = (
  kind: "collection" | "object",
  baseType: string,
  members: IocGroupNodeManifest,
): IocGroupRootManifest => ({
  kind,
  baseType,
  baseTypeId: `/fake/${baseType}.ts:${baseType}`,
  members,
});

const makeLeaf = (contractName: string) => ({
  contractName,
  registrationKey:
    contractName.charAt(0).toLowerCase() + contractName.slice(1),
});

const makeConfig = (groups?: IocConfig["groups"]): IocConfig => ({
  discovery: { scanDirs: "src" },
  ...(groups !== undefined ? { groups } : {}),
});

describe("validateNonEmptyGroupsAtCodegen", () => {
  describe("When the groups manifest is undefined (no groups configured)", () => {
    it("should not throw", () => {
      validateNonEmptyGroupsAtCodegen(undefined, undefined);
    });
  });

  describe("When a collection group resolved to zero members", () => {
    it("should throw naming the group key, base type, likely causes, and the discovery report", () => {
      const manifest: IocGroupsManifest = {
        tasks: makeRoot("collection", "TaskBase", []),
      };

      assert.throws(
        () => validateNonEmptyGroupsAtCodegen(manifest, makeConfig()),
        (error: Error) => {
          assert.match(error.message, /"tasks"/);
          assert.match(error.message, /"TaskBase"/);
          assert.match(error.message, /ReadonlyArray<never>/);
          assert.match(error.message, /bare union/);
          assert.match(error.message, /misspelled/);
          assert.match(error.message, /ioc --discovery/);
          assert.match(error.message, /allowEmpty/);
          return true;
        },
      );
    });
  });

  describe("When an object group resolved to zero members", () => {
    it("should throw naming the group key and base type", () => {
      const manifest: IocGroupsManifest = {
        writeServices: makeRoot("object", "WriteServiceBase", {}),
      };

      assert.throws(
        () => validateNonEmptyGroupsAtCodegen(manifest, makeConfig()),
        (error: Error) => {
          assert.match(error.message, /"writeServices"/);
          assert.match(error.message, /"WriteServiceBase"/);
          return true;
        },
      );
    });
  });

  describe("When groups of both kinds have members", () => {
    it("should not throw", () => {
      const manifest: IocGroupsManifest = {
        tasks: makeRoot("collection", "TaskBase", [makeLeaf("SyncTask")]),
        writeServices: makeRoot("object", "WriteServiceBase", {
          mediaWriter: makeLeaf("MediaWriter"),
        }),
      };

      validateNonEmptyGroupsAtCodegen(manifest, makeConfig());
    });
  });

  describe("When an empty group opts in with allowEmpty: true", () => {
    it("should not throw for that group", () => {
      const manifest: IocGroupsManifest = {
        tasks: makeRoot("collection", "TaskBase", []),
      };
      const config = makeConfig({
        tasks: { kind: "collection", baseType: "TaskBase", allowEmpty: true },
      });

      validateNonEmptyGroupsAtCodegen(manifest, config);
    });

    it("should still throw for other empty groups without the opt-in", () => {
      const manifest: IocGroupsManifest = {
        tasks: makeRoot("collection", "TaskBase", []),
        writeServices: makeRoot("object", "WriteServiceBase", {}),
      };
      const config = makeConfig({
        tasks: { kind: "collection", baseType: "TaskBase", allowEmpty: true },
        writeServices: { kind: "object", baseType: "WriteServiceBase" },
      });

      assert.throws(
        () => validateNonEmptyGroupsAtCodegen(manifest, config),
        (error: Error) => {
          assert.match(error.message, /"writeServices"/);
          assert.doesNotMatch(error.message, /"tasks"/);
          return true;
        },
      );
    });
  });

  describe("When an empty group's key exists in a composed package manifest (app mode)", () => {
    it("should not throw — members merge in at runtime via composeManifests", () => {
      const manifest: IocGroupsManifest = {
        tasks: makeRoot("collection", "TaskBase", []),
      };

      validateNonEmptyGroupsAtCodegen(
        manifest,
        makeConfig({ tasks: { kind: "collection", baseType: "TaskBase" } }),
        new Set(["tasks"]),
      );
    });

    it("should still throw when the composed manifests declare only other groups", () => {
      const manifest: IocGroupsManifest = {
        tasks: makeRoot("collection", "TaskBase", []),
      };

      assert.throws(
        () =>
          validateNonEmptyGroupsAtCodegen(
            manifest,
            makeConfig(),
            new Set(["channels"]),
          ),
        /"tasks"/,
      );
    });
  });

  describe("When multiple groups are empty", () => {
    it("should aggregate all offenders into one error", () => {
      const manifest: IocGroupsManifest = {
        tasks: makeRoot("collection", "TaskBase", []),
        writeServices: makeRoot("object", "WriteServiceBase", {}),
      };

      assert.throws(
        () => validateNonEmptyGroupsAtCodegen(manifest, makeConfig()),
        (error: Error) => {
          assert.match(error.message, /"tasks"/);
          assert.match(error.message, /"writeServices"/);
          return true;
        },
      );
    });
  });
});
