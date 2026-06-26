import assert from "node:assert";
import { describe, it } from "node:test";
import { createContainer } from "awilix";
import type { MediaStorage } from "../examples/b-multiple-implementations.js";
import type { IocGeneratedCradle } from "../generated/ioc-registry.types.js";
import { iocManifest } from "../generated/ioc-manifest.js";
import { registerIocFromManifest } from "./bootstrap.js";

describe("registerIocFromManifest", () => {
  describe("When resolving the contract default slot", () => {
    it("should resolve to the selected default implementation", async () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(container, [iocManifest]);
      const media = container.resolve("mediaStorage") as MediaStorage;
      await media.put("k");
      assert.strictEqual(media.label, "direct-contract");
    });
  });

  describe("When resolving named implementation registrations", () => {
    it("should resolve each registration key to its factory", async () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(container, [iocManifest]);
      const local = container.resolve("localMediaStorage") as MediaStorage;
      await local.put("k");
      assert.strictEqual(local.label, "local");
      const albumService = container.resolve("albumService") as {
        describe: () => string;
      };
      assert.match(albumService.describe(), /albums backed by direct-contract/i);
    });
  });

  describe("When resolving generated groups", () => {
    it("should register group roots and resolve collection members from the cradle", () => {
      const container = createContainer<IocGeneratedCradle>();
      registerIocFromManifest(container, [iocManifest]);

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
