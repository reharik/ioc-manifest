import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IocConfig } from "../config/iocConfig.js";
import { buildComposedRegistrationOverridesFromConfig } from "./buildComposedRegistrationOverrides.js";

describe("buildComposedRegistrationOverridesFromConfig", () => {
  describe("When the app config declares defaults and source overrides", () => {
    it("should build contracts and composedPackageNames", () => {
      const config: IocConfig = {
        discovery: { scanDirs: "src" },
        composedManifests: ["@test/lib"],
        registrations: {
          MediaStorage: {
            mockMediaStorage: { default: true },
          },
          AlbumRepository: {
            albumRepository: { source: "local" },
          },
        },
      };

      const overrides = buildComposedRegistrationOverridesFromConfig(config);
      assert.deepEqual(overrides?.composedPackageNames, ["@test/lib"]);
      assert.equal(
        overrides?.contracts?.MediaStorage?.defaultImplementation,
        "mockMediaStorage",
      );
      assert.deepEqual(
        overrides?.contracts?.AlbumRepository?.sourceOverride,
        { albumRepository: "local" },
      );
    });
  });
});
