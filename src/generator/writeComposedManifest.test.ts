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

  /**
   * `Pick<T, K>` requires `K extends keyof T`, so a relocated key left inside `keyof XExternals`
   * errors AT THE PICK — before any per-key assertion can say anything useful, and with a message
   * about a type operator rather than about a missing dependency. Narrowing the pick is therefore
   * required by any design that clears a key at all, independently of what replaces it.
   */
  describe("When a package has a relocated external", () => {
    const sourceWithRelocation = (relocatedKey: string) =>
      buildComposedManifestSource({
        generatedDir: "/tmp/generated",
        composedPackages: resolveComposedPackageSpecs(["@test/infra"]).map(
          (spec) => ({
            ...spec,
            externalKeys: ["logger", "logContext"],
            relocatedExternals: [
              { key: relocatedKey, reachingOpenerKeys: ["openRequestScope"] },
            ],
          }),
        ),
        overrides: undefined,
      });

    it("should name the remaining keys explicitly instead of keyof", () => {
      const source = sourceWithRelocation("logContext");
      assert.match(
        source,
        /type _InfraExternalsPick = Pick<AppCradle, "logger">;/,
      );
      assert.doesNotMatch(source, /Pick<AppCradle, keyof InfraExternals>/);
    });

    it("should not assert the relocated key against the cradle", () => {
      const source = sourceWithRelocation("logContext");
      assert.match(source, /type _Infra_logger = _InfraExternalsPick\["logger"\]/);
      assert.doesNotMatch(
        source,
        /_InfraExternalsPick\["logContext"\] extends InfraExternals\["logContext"\]/,
      );
    });

    /**
     * A key relocated with NO reaching openers: satisfied by an explicit `scopeProvided`
     * declaration, which registers the value onto the child scope by hand rather than passing it
     * through an opener's parameter. There is no signature to assert against, and asserting against
     * one would fail a correct build — so the key leaves the pick and takes no assertion with it.
     */
    it("should drop the key entirely when no opener carries it", () => {
      const source = buildComposedManifestSource({
        generatedDir: "/tmp/generated",
        composedPackages: resolveComposedPackageSpecs(["@test/infra"]).map(
          (spec) => ({
            ...spec,
            externalKeys: ["logger", "logContext"],
            relocatedExternals: [{ key: "logContext", reachingOpenerKeys: [] }],
          }),
        ),
        overrides: undefined,
      });

      assert.match(
        source,
        /type _InfraExternalsPick = Pick<AppCradle, "logger">;/,
      );
      assert.doesNotMatch(source, /_Infra_logContext/);
    });

    it("should emit no pick at all when every key relocated", () => {
      const source = buildComposedManifestSource({
        generatedDir: "/tmp/generated",
        composedPackages: resolveComposedPackageSpecs(["@test/infra"]).map(
          (spec) => ({
            ...spec,
            externalKeys: ["logContext"],
            relocatedExternals: [
              { key: "logContext", reachingOpenerKeys: ["openRequestScope"] },
            ],
          }),
        ),
        overrides: undefined,
      });
      assert.doesNotMatch(source, /_InfraExternalsPick/);
    });
  });

  describe("When nothing is relocated", () => {
    /**
     * Byte stability, stated as an equality rather than as a pattern: the overwhelming majority of
     * compositions clear nothing, and their `ioc-composed.ts` must not move by a single character.
     */
    it("should emit exactly what an absent relocation list emits", () => {
      const specs = resolveComposedPackageSpecs([
        "@test/media-core",
        "@test/infra",
      ]).map((spec) => ({ ...spec, externalKeys: ["config", "logger"] }));

      const withoutField = buildComposedManifestSource({
        generatedDir: "/tmp/generated",
        composedPackages: specs,
        overrides: undefined,
      });
      const withEmptyField = buildComposedManifestSource({
        generatedDir: "/tmp/generated",
        composedPackages: specs.map((spec) => ({
          ...spec,
          relocatedExternals: [],
        })),
        overrides: undefined,
      });

      assert.equal(withEmptyField, withoutField);
      assert.match(
        withoutField,
        /type _MediaCoreExternalsPick = Pick<AppCradle, keyof MediaCoreExternals>;/,
      );
    });
  });
});
