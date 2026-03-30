import assert from "node:assert";
import { describe, it } from "node:test";
import { createContainer } from "awilix";
import type { MediaStorage } from "../examples/b-multiple-implementations.js";
import { extractGroupRootsFromContainerManifest } from "../core/manifest.js";
import type { IocGeneratedCradle } from "../generated/ioc-registry.types.js";
import { iocManifest } from "../generated/ioc-manifest.js";
import { registerIocFromManifest } from "./bootstrap.js";

describe("registerIocFromManifest", () => {
  describe("When resolving the contract default slot", () => {
    it("should resolve to the selected default implementation", async () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(
        container,
        iocManifest.contracts,
        iocManifest.moduleImports,
        extractGroupRootsFromContainerManifest(iocManifest),
      );
      const media = container.resolve("mediaStorage") as MediaStorage;
      await media.put("k");
      assert.strictEqual(media.label, "direct-contract");
    });
  });

  describe("When resolving named implementation registrations", () => {
    it("should resolve each registration key to its factory", async () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(
        container,
        iocManifest.contracts,
        iocManifest.moduleImports,
        extractGroupRootsFromContainerManifest(iocManifest),
      );
      const local = container.resolve("localMediaStorage") as MediaStorage;
      await local.put("k");
      assert.strictEqual(local.label, "local");
      const albumService = container.resolve("albumService") as {
        describe: () => string;
      };
      assert.match(albumService.describe(), /albums backed by direct-contract/i);
    });
  });

  describe("When resolving the collection key for a multi-implementation contract", () => {
    it("should expose a ReadonlyArray of every concrete implementation", async () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(
        container,
        iocManifest.contracts,
        iocManifest.moduleImports,
        extractGroupRootsFromContainerManifest(iocManifest),
      );
      const collection = container.resolve("mediaStorages") as readonly MediaStorage[];
      assert.ok(Array.isArray(collection));
      assert.strictEqual(collection.length, 3);
      const byLabel = new Map(
        collection.map((m) => [m.label, m] as const),
      );
      await byLabel.get("local")!.put("k");
      await byLabel.get("s3")!.put("k");
      assert.strictEqual(byLabel.get("local")!.label, "local");
      assert.strictEqual(byLabel.get("s3")!.label, "s3");
    });
  });

  describe("When resolving generated groups", () => {
    it("should register group roots and resolve collection members from the cradle", () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(
        container,
        iocManifest.contracts,
        iocManifest.moduleImports,
        extractGroupRootsFromContainerManifest(iocManifest),
      );

      const mediaGroup = container.resolve("mediaStoragesGroup") as MediaStorage[];
      assert.ok(Array.isArray(mediaGroup));
      assert.strictEqual(mediaGroup.length, 2);
      const labels = mediaGroup.map((m) => m.label).sort();
      assert.deepStrictEqual(labels, ["local", "s3"]);
      assert.ok(
        new Set(mediaGroup.map((m) => m.label)).size === mediaGroup.length,
        "collection group should not duplicate implementations",
      );
    });
  });
});
