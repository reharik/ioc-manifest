import assert from "node:assert";
import { describe, it } from "node:test";
import type { ResolvedContractRegistration } from "../generator/resolveRegistrationPlan.js";
import { buildBundlePlan, type IocBundlesConfig } from "./resolveBundlePlan.js";

const makePlan = (
  contractName: string,
  contractKey: string,
): ResolvedContractRegistration => ({
  contractName,
  contractTypeRelImport: "../contracts.js",
  contractKey,
  collectionKey: undefined,
  defaultImplementationName: contractKey,
  implementations: [
    {
      implementationName: contractKey,
      exportName: `build${contractName}`,
      modulePath: "m.ts",
      relImport: "../m.js",
      registrationKey: contractKey,
      lifetime: "singleton",
    },
  ],
});

const plans: ResolvedContractRegistration[] = [
  makePlan("ListAlbums", "listAlbums"),
  makePlan("GetAlbumById", "getAlbumById"),
  makePlan("CreateAlbum", "createAlbum"),
  makePlan("MediaStorage", "mediaStorage"),
];

describe("buildBundlePlan", () => {
  describe("When bundles are omitted", () => {
    it("should return undefined for backward compatibility", () => {
      assert.strictEqual(buildBundlePlan(undefined, plans), undefined);
    });
  });

  describe("When a simple bundle tree is provided", () => {
    it("should resolve contract leaves to contract registration keys", () => {
      const config: IocBundlesConfig = {
        services: {
          read: ["ListAlbums", "GetAlbumById"],
        },
      };

      const resolved = buildBundlePlan(config, plans);
      assert.deepStrictEqual(resolved?.tree, {
        services: {
          read: [
            { contractName: "ListAlbums", registrationKey: "listAlbums" },
            { contractName: "GetAlbumById", registrationKey: "getAlbumById" },
          ],
        },
      });
    });
  });

  describe("When nested bundles are provided", () => {
    it("should preserve the nested object shape", () => {
      const config: IocBundlesConfig = {
        services: {
          album: {
            read: ["ListAlbums"],
            write: ["CreateAlbum"],
          },
          media: {
            read: ["MediaStorage"],
          },
        },
      };

      const resolved = buildBundlePlan(config, plans);
      assert.ok(resolved);
      assert.deepStrictEqual(Object.keys(resolved.tree.services), ["album", "media"]);
      assert.strictEqual(
        Array.isArray((resolved.tree.services as Record<string, unknown>).album),
        false,
      );
    });
  });

  describe("When bundles use composition references", () => {
    it("should expand referenced bundle arrays in order", () => {
      const config: IocBundlesConfig = {
        services: {
          album: {
            read: ["ListAlbums", "GetAlbumById"],
          },
          allRead: [{ $bundleRef: "services.album.read" }, "MediaStorage"],
        },
      };

      const resolved = buildBundlePlan(config, plans);
      const services = resolved?.tree.services as Record<string, unknown>;
      assert.deepStrictEqual(services.allRead, [
        { contractName: "ListAlbums", registrationKey: "listAlbums" },
        { contractName: "GetAlbumById", registrationKey: "getAlbumById" },
        { contractName: "MediaStorage", registrationKey: "mediaStorage" },
      ]);
    });
  });

  describe("When a bundle references an unknown contract", () => {
    it("should throw with the contract path context", () => {
      const config: IocBundlesConfig = {
        services: {
          read: ["UnknownContract"],
        },
      };
      assert.throws(
        () => buildBundlePlan(config, plans),
        /references unknown contract "UnknownContract"/,
      );
    });
  });

  describe("When a bundle references an unknown bundle path", () => {
    it("should throw with the source path context", () => {
      const config: IocBundlesConfig = {
        services: {
          read: [{ $bundleRef: "services.missing.read" }],
        },
      };
      assert.throws(
        () => buildBundlePlan(config, plans),
        /references unknown bundle path "services\.missing\.read"/,
      );
    });
  });

  describe("When bundle references are circular", () => {
    it("should throw with the cycle chain", () => {
      const config: IocBundlesConfig = {
        services: {
          a: [{ $bundleRef: "services.b" }],
          b: [{ $bundleRef: "services.a" }],
        },
      };
      assert.throws(
        () => buildBundlePlan(config, plans),
        /Circular bundle reference detected/,
      );
    });
  });

  describe("When bundle nodes have invalid shapes", () => {
    it("should throw deterministically for invalid array item nodes", () => {
      const config: unknown = {
        services: {
          read: ["ListAlbums", { wrong: "shape" }],
        },
      };
      assert.throws(
        () => buildBundlePlan(config, plans),
        /has invalid shape/,
      );
    });
  });

  describe("When a bundle root key collides with a registration key", () => {
    it("should throw with a clear message", () => {
      const config: IocBundlesConfig = {
        mediaStorage: ["ListAlbums"],
      };
      assert.throws(
        () => buildBundlePlan(config, plans),
        /bundles root key "mediaStorage" collides/,
      );
    });
  });

  describe("When a bundle array lists the same contract more than once", () => {
    it("should dedupe by contract name while preserving first occurrence order", () => {
      const config: IocBundlesConfig = {
        services: {
          read: ["ListAlbums", "MediaStorage", "ListAlbums"],
        },
      };
      const resolved = buildBundlePlan(config, plans);
      assert.ok(resolved);
      const read = (resolved.tree.services as { read: unknown }).read as {
        contractName: string;
      }[];
      assert.deepStrictEqual(
        read.map((x) => x.contractName),
        ["ListAlbums", "MediaStorage"],
      );
    });
  });
});
