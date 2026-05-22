import assert from "node:assert";
import { describe, it } from "node:test";
import type {
  IocContractManifest,
  IocModuleNamespace,
  IocRegisterableManifest,
} from "../core/manifest.js";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";
import {
  composeManifests,
  formatConflictingGroupRootKeyError,
  formatConflictingRegistrationKeyError,
  formatManifestSchemaVersionMismatchError,
  prepareManifestsForRegistration,
  validateManifestSchemaVersions,
} from "./composeManifests.js";

const baseManifest = (
  contracts: IocContractManifest,
  moduleImports: readonly IocModuleNamespace[] = [],
  extras: Record<string, unknown> = {},
): IocRegisterableManifest => ({
  manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
  moduleImports,
  contracts,
  ...extras,
});

describe("composeManifests", () => {
  describe("When manifest schema version does not match runtime", () => {
    it("should throw listing every mismatch with original input indices", () => {
      const valid = baseManifest({});
      const badAt1 = {
        ...baseManifest({}),
        manifestSchemaVersion: 1 as unknown as typeof MANIFEST_SCHEMA_VERSION,
      };
      const badAt2 = {
        ...baseManifest({
          Other: {
            o: {
              exportName: "buildO",
              registrationKey: "other",
              modulePath: "o.ts",
              relImport: "../o.js",
              contractName: "Other",
              implementationName: "o",
              lifetime: "singleton",
              moduleIndex: 0,
            },
          },
        }),
        manifestSchemaVersion: 1 as unknown as typeof MANIFEST_SCHEMA_VERSION,
      };
      assert.throws(
        () => prepareManifestsForRegistration([valid, badAt1, badAt2]),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /Manifest schema version mismatch/);
          assert.match(err.message, /Runtime expects: 2/);
          assert.match(err.message, /Got: 1 from manifest at index 1/);
          assert.match(err.message, /Got: 1 from manifest at index 2/);
          assert.doesNotMatch(err.message, /index 0/);
          return true;
        },
      );
    });

    it("should format schema mismatch errors without registering", () => {
      const msg = formatManifestSchemaVersionMismatchError([
        { version: 99, originalIndex: 3 },
      ]);
      assert.match(msg, /Got: 99 from manifest at index 3/);
    });
  });

  describe("When two manifests contribute different implementations of the same contract", () => {
    it("should merge implementations and preserve distinct registration keys", () => {
      const factoryA = (): { tag: string } => ({ tag: "a" });
      const factoryB = (): { tag: string } => ({ tag: "b" });
      const manifestA = baseManifest(
        {
          MediaStorage: {
            s3: {
              exportName: "buildS3",
              registrationKey: "s3MediaStorage",
              modulePath: "a.ts",
              relImport: "../a.js",
              contractName: "MediaStorage",
              implementationName: "s3",
              lifetime: "singleton",
              moduleIndex: 0,
            },
          },
        },
        [{ buildS3: factoryA }],
      );
      const manifestB = baseManifest(
        {
          MediaStorage: {
            mock: {
              exportName: "buildMock",
              registrationKey: "mockMediaStorage",
              modulePath: "b.ts",
              relImport: "../b.js",
              contractName: "MediaStorage",
              implementationName: "mock",
              lifetime: "singleton",
              moduleIndex: 0,
            },
          },
        },
        [{ buildMock: factoryB }],
      );

      const composed = composeManifests([manifestA, manifestB]);
      const mediaImpls = Object.keys(composed.contracts.MediaStorage ?? {});
      assert.deepEqual(mediaImpls.sort(), ["mock", "s3"]);
    });
  });

  describe("When sourceOverride selects local for a conflicting registration key", () => {
    it("should keep the local manifest implementation and drop the other", () => {
      const local = baseManifest({
        AlbumRepository: {
          albumRepository: {
            exportName: "buildLocal",
            registrationKey: "albumRepository",
            modulePath: "local.ts",
            relImport: "../local.js",
            contractName: "AlbumRepository",
            implementationName: "albumRepository",
            lifetime: "singleton",
            moduleIndex: 0,
          },
        },
      });
      const remote = baseManifest({
        OtherContract: {
          other: {
            exportName: "buildRemote",
            registrationKey: "albumRepository",
            modulePath: "remote.ts",
            relImport: "../remote.js",
            contractName: "OtherContract",
            implementationName: "other",
            lifetime: "singleton",
            moduleIndex: 0,
          },
        },
      });

      const composed = composeManifests([local, remote], {
        composedPackageNames: ["@test/remote-pkg"],
        contracts: {
          AlbumRepository: {
            sourceOverride: { albumRepository: "local" },
          },
        },
      });

      assert.ok(composed.contracts.AlbumRepository?.albumRepository);
      assert.equal(composed.contracts.OtherContract, undefined);
    });
  });

  describe("When defaultImplementation override is set across manifests", () => {
    it("should apply the app default without throwing a cross-manifest default conflict", () => {
      const manifestA = baseManifest({
        MediaStorage: {
          s3: {
            exportName: "buildS3",
            registrationKey: "s3MediaStorage",
            modulePath: "a.ts",
            relImport: "../a.js",
            contractName: "MediaStorage",
            implementationName: "s3",
            lifetime: "singleton",
            moduleIndex: 0,
            default: true,
          },
        },
      });
      const manifestB = baseManifest({
        MediaStorage: {
          mock: {
            exportName: "buildMock",
            registrationKey: "mockMediaStorage",
            modulePath: "b.ts",
            relImport: "../b.js",
            contractName: "MediaStorage",
            implementationName: "mock",
            lifetime: "singleton",
            moduleIndex: 0,
            default: true,
          },
        },
      });

      const composed = composeManifests([manifestA, manifestB], {
        contracts: {
          MediaStorage: { defaultImplementation: "mock" },
        },
      });

      assert.strictEqual(composed.contracts.MediaStorage?.mock?.default, true);
      assert.equal(composed.contracts.MediaStorage?.s3?.default, undefined);
    });
  });

  describe("When two manifests register the same Awilix key", () => {
    it("should throw with original indices and contract metadata", () => {
      const manifestA = baseManifest({
        AlbumRepository: {
          albumRepository: {
            exportName: "buildA",
            registrationKey: "albumRepository",
            modulePath: "a.ts",
            relImport: "../a.js",
            contractName: "AlbumRepository",
            implementationName: "albumRepository",
            lifetime: "singleton",
            moduleIndex: 0,
          },
        },
      });
      const manifestB = baseManifest({
        OtherContract: {
          other: {
            exportName: "buildB",
            registrationKey: "albumRepository",
            modulePath: "b.ts",
            relImport: "../b.js",
            contractName: "OtherContract",
            implementationName: "other",
            lifetime: "singleton",
            moduleIndex: 0,
          },
        },
      });

      assert.throws(
        () => composeManifests([manifestB, manifestA]),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          const expected = formatConflictingRegistrationKeyError(
            "albumRepository",
            {
              kind: "implementation",
              originalIndex: 0,
              contractName: "OtherContract",
              implementationName: "other",
            },
            {
              kind: "implementation",
              originalIndex: 1,
              contractName: "AlbumRepository",
              implementationName: "albumRepository",
            },
          );
          assert.strictEqual(err.message, expected);
          return true;
        },
      );
    });
  });

  describe("When two manifests declare the same group root key", () => {
    it("should throw the group-root conflict message with original indices", () => {
      const groupRoot = {
        kind: "collection" as const,
        baseType: "Widget",
        baseTypeId: "/fake/Widget.ts:Widget",
        members: [
          {
            contractName: "Widget",
            registrationKey: "widget",
          },
        ],
      };
      const manifestA = baseManifest({}, [], { myGroup: groupRoot });
      const manifestB = baseManifest({}, [], { myGroup: groupRoot });

      assert.throws(
        () => composeManifests([manifestA, manifestB]),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.strictEqual(
            err.message,
            formatConflictingGroupRootKeyError("myGroup", 0, 1),
          );
          return true;
        },
      );
    });
  });

  describe("When manifest array order differs", () => {
    it("should produce identical composed contracts for [a,b] and [b,a]", () => {
      const manifestA = baseManifest({
        Foo: {
          a: {
            exportName: "buildA",
            registrationKey: "fooA",
            modulePath: "a.ts",
            relImport: "../a.js",
            contractName: "Foo",
            implementationName: "a",
            lifetime: "singleton",
            moduleIndex: 0,
            default: true,
          },
        },
      });
      const manifestB = baseManifest({
        Bar: {
          b: {
            exportName: "buildB",
            registrationKey: "barB",
            modulePath: "b.ts",
            relImport: "../b.js",
            contractName: "Bar",
            implementationName: "b",
            lifetime: "singleton",
            moduleIndex: 0,
          },
        },
      });

      const ab = composeManifests([manifestA, manifestB]);
      const ba = composeManifests([manifestB, manifestA]);
      assert.deepStrictEqual(ab.contracts, ba.contracts);
      assert.strictEqual(ab.moduleImports.length, ba.moduleImports.length);
    });

    it("should throw the same conflict for [a,b] and [b,a] with indices matching caller order", () => {
      const manifestA = baseManifest({
        X: {
          x: {
            exportName: "buildX",
            registrationKey: "dup",
            modulePath: "a.ts",
            relImport: "../a.js",
            contractName: "X",
            implementationName: "x",
            lifetime: "singleton",
            moduleIndex: 0,
          },
        },
      });
      const manifestB = baseManifest({
        Y: {
          y: {
            exportName: "buildY",
            registrationKey: "dup",
            modulePath: "b.ts",
            relImport: "../b.js",
            contractName: "Y",
            implementationName: "y",
            lifetime: "singleton",
            moduleIndex: 0,
          },
        },
      });

      const expectConflict = (fn: () => void): Error => {
        try {
          fn();
        } catch (err: unknown) {
          assert.ok(err instanceof Error);
          return err;
        }
        assert.fail("expected composeManifests to throw");
      };

      const messageAb = expectConflict(() =>
        composeManifests([manifestA, manifestB]),
      );
      const messageBa = expectConflict(() =>
        composeManifests([manifestB, manifestA]),
      );
      assert.match(messageAb.message, /Conflicting registration key "dup"/);
      assert.match(messageBa.message, /Conflicting registration key "dup"/);
      assert.match(messageAb.message, /manifest at index 0/);
      assert.match(messageAb.message, /manifest at index 1/);
      assert.match(messageBa.message, /manifest at index 0/);
      assert.match(messageBa.message, /manifest at index 1/);
      assert.notStrictEqual(messageAb.message, messageBa.message);
    });
  });

  describe("When duplicate manifest references appear in the input array", () => {
    it("should deduplicate by reference without changing composition", () => {
      const manifest = baseManifest({
        Only: {
          only: {
            exportName: "buildOnly",
            registrationKey: "onlyKey",
            modulePath: "o.ts",
            relImport: "../o.js",
            contractName: "Only",
            implementationName: "only",
            lifetime: "singleton",
            moduleIndex: 0,
          },
        },
      });
      const once = composeManifests([manifest]);
      const twice = composeManifests([manifest, manifest]);
      assert.deepStrictEqual(once.contracts, twice.contracts);
    });
  });

  describe("When validateManifestSchemaVersions runs on indexed manifests", () => {
    it("should use original indices after internal sort would reorder manifests", () => {
      const lowFingerprint = baseManifest({
        Zzz: {
          z: {
            exportName: "buildZ",
            registrationKey: "zzz",
            modulePath: "z.ts",
            relImport: "../z.js",
            contractName: "Zzz",
            implementationName: "z",
            lifetime: "singleton",
            moduleIndex: 0,
          },
        },
      });
      const bad = {
        ...baseManifest({
          Aaa: {
            a: {
              exportName: "buildA",
              registrationKey: "aaa",
              modulePath: "a.ts",
              relImport: "../a.js",
              contractName: "Aaa",
              implementationName: "a",
              lifetime: "singleton",
              moduleIndex: 0,
            },
          },
        }),
        manifestSchemaVersion: 9 as unknown as typeof MANIFEST_SCHEMA_VERSION,
      };

      assert.throws(
        () =>
          validateManifestSchemaVersions([
            { manifest: lowFingerprint, originalIndex: 0 },
            { manifest: bad, originalIndex: 1 },
          ]),
        /Got: 9 from manifest at index 1/,
      );
    });
  });
});
