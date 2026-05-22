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
      ]);
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

      assert.match(source, /export const composedManifests = \[localManifest, mediaCoreManifest, infraManifest\] as const;/);
      assert.match(source, /export type AppCradle = LocalCradle & MediaCoreCradle & InfraCradle;/);
      assert.match(source, /type _IocExpect<T extends true> = T;/);
      assert.match(source, /type _MediaCoreExternalsSatisfied/);
      assert.match(
        source,
        /MediaCoreExternals extends Pick<AppCradle, keyof MediaCoreExternals> \? true : false;/,
      );
      assert.match(source, /type _MediaCoreExternalsAssert = _IocExpect<_MediaCoreExternalsSatisfied>/);
      assert.match(source, /type _InfraExternalsAssert = _IocExpect/);
      assert.match(source, /defaultImplementation: "mockMediaStorage"/);
      assert.match(source, /"albumRepository": "local"/);
      assert.match(source, /as const satisfies ComposedRegistrationOverrides/);
    });
  });
});
