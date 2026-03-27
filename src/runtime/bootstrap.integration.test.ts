import assert from "node:assert";
import { describe, it } from "node:test";
import { createContainer } from "awilix";
import type { MediaStorage } from "../examples/b-multiple-implementations.js";
import type { AlbumService } from "../examples/f-dependency-injection.js";
import type { IocGeneratedCradle } from "../generated/ioc-registry.types.js";
import {
  iocBundlesManifest,
  iocManifestByContract,
  iocModuleImports,
} from "../generated/ioc-manifest.js";
import { registerIocFromManifest } from "./bootstrap.js";

describe("registerIocFromManifest", () => {
  describe("When resolving the contract default slot", () => {
    it("should resolve to the selected default implementation", async () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(
        container,
        iocManifestByContract,
        iocModuleImports,
        iocBundlesManifest,
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
        iocManifestByContract,
        iocModuleImports,
        iocBundlesManifest,
      );
      const local = container.resolve("localMediaStorage") as MediaStorage;
      await local.put("k");
      assert.strictEqual(local.label, "local");
      const albumService = container.resolve("albumService") as AlbumService;
      assert.match(albumService.describe(), /albums backed by direct-contract/i);
    });
  });

  describe("When resolving the collection key for a multi-implementation contract", () => {
    it("should expose an object map keyed by implementation name", async () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(
        container,
        iocManifestByContract,
        iocModuleImports,
        iocBundlesManifest,
      );
      const collection = container.resolve("mediaStorages") as Record<
        string,
        MediaStorage
      >;
      assert.ok(collection && typeof collection === "object");
      await collection.localMediaStorage.put("k");
      await collection.s3MediaStorage.put("k");
      assert.strictEqual(collection.localMediaStorage.label, "local");
      assert.strictEqual(collection.s3MediaStorage.label, "s3");
    });
  });

  describe("When resolving generated bundles", () => {
    it("should register bundle roots on the cradle and resolve leaves to contract defaults", () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(
        container,
        iocManifestByContract,
        iocModuleImports,
        iocBundlesManifest,
      );

      const services = container.resolve("services") as {
        album: AlbumService[];
        media: { read: MediaStorage[] };
        read: Array<AlbumService | MediaStorage>;
      };

      assert.strictEqual(typeof services, "object");
      assert.strictEqual(services.album.length, 1);
      assert.strictEqual(services.album[0]?.describe().includes("albums"), true);
      assert.strictEqual(services.media.read.length, 1);
      assert.strictEqual(services.media.read[0]?.label, "direct-contract");
      assert.strictEqual(services.read.length, 2);
    });
  });
});
