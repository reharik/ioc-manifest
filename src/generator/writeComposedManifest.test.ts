import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildComposedManifestSource,
  resolveComposedPackageSpecs,
} from "./writeComposedManifest.js";

describe("buildComposedManifestSource", () => {
  describe("When composing two packages", () => {
    it("should emit composedManifests as const and AppCradle intersection", () => {
      const specs = resolveComposedPackageSpecs([
        "@test/media-core",
        "@test/infra",
      ]).map((spec) => {
        if (spec.identifier === "mediaCore") {
          return { ...spec, externalKeys: ["config", "database"] };
        }
        if (spec.identifier === "infra") {
          return { ...spec, externalKeys: ["logger"] };
        }
        return spec;
      });
      const source = buildComposedManifestSource({
        generatedDir: "/tmp/generated",
        composedPackages: specs,
        overrides: {
          contracts: {
            MediaStorage: { defaultImplementation: "mockMediaStorage" },
            AlbumRepository: {
              sourceOverride: { albumRepository: "local" },
            },
          },
        },
      });

      assert.match(
        source,
        /export const composedManifests = \[localManifest, mediaCoreManifest, infraManifest\] as const;/,
      );
      assert.match(
        source,
        /export type AppCradle = LocalCradle & MediaCoreCradle & InfraCradle;/,
      );
      assert.match(source, /type _IocExpect<T extends true> = T;/);
      assert.match(
        source,
        /If any assertion below is `false`, run `ioc validate` for a detailed per-key explanation\./,
      );
      assert.match(
        source,
        /type _MediaCoreExternalsPick = Pick<AppCradle, keyof MediaCoreExternals>;/,
      );
      assert.match(
        source,
        /type _MediaCore_config = _MediaCoreExternalsPick\["config"\] extends MediaCoreExternals\["config"\] \? true : false;/,
      );
      assert.match(
        source,
        /type _MediaCore_configAssert = _IocExpect<_MediaCore_config>;/,
      );
      assert.match(
        source,
        /type _MediaCore_database = _MediaCoreExternalsPick\["database"\] extends MediaCoreExternals\["database"\] \? true : false;/,
      );
      assert.match(
        source,
        /type _Infra_logger = _InfraExternalsPick\["logger"\] extends InfraExternals\["logger"\] \? true : false;/,
      );
      assert.match(source, /type _Infra_loggerAssert = _IocExpect<_Infra_logger>/);
      assert.match(source, /defaultImplementation: "mockMediaStorage"/);
      assert.match(source, /"albumRepository": "local"/);
      assert.match(source, /as const satisfies ComposedRegistrationOverrides/);
    });
  });
});
