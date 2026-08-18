/**
 * v3 unifies every registration-key derivation on one camelCase rule — Awilix's own
 * `formatName: "camelCase"` algorithm — so a codebase migrating off `loadModules` keeps its
 * container keys and a contract reaches the cradle under one spelling regardless of which unit kind
 * supplies it.
 *
 * Three derivations share the rule: a factory's export name past the prefix, a class's name, and a
 * contract's access key. Through v2 the first and third lowercased exactly one character, which
 * diverged from the class rule on any name with an acronym run (`buildAPIClient` → `aPIClient` vs
 * `APIClient` → `apiClient`). These cases pin the unification; the acronym rows are the ones that
 * would regress if the old one-character rule ever came back.
 */
import assert from "node:assert";
import { describe, it } from "node:test";
import {
  awilixCamelCase,
  keyFromClassName,
  keyFromExportName,
  resolveRegistrationKeyForClass,
  resolveRegistrationKeyForFactory,
} from "./resolver.js";
import { contractNameToDefaultRegistrationKey } from "../generator/naming.js";

/** `[bare name, expected key]` — the name a class carries and a factory export carries past `build`. */
const CASES: readonly (readonly [string, string])[] = [
  ["MediaStorage", "mediaStorage"],
  ["Logger", "logger"],
  ["AlbumService", "albumService"],
  ["S3MediaStorage", "s3MediaStorage"],
  ["APIClient", "apiClient"],
  ["HTTPSProxy", "httpsProxy"],
  ["HTMLParser", "htmlParser"],
];

describe("registration key camelCase (v3 unified rule)", () => {
  describe("When a class name is camelCased", () => {
    for (const [className, expected] of CASES) {
      it(`should key ${className} as ${expected}`, () => {
        assert.strictEqual(keyFromClassName(className), expected);
      });
    }

    it("should lowercase a bare acronym run entirely", () => {
      assert.strictEqual(keyFromClassName("API"), "api");
      assert.strictEqual(keyFromClassName("S3"), "s3");
    });
  });

  describe("When a factory export name is camelCased past the prefix", () => {
    for (const [name, expected] of CASES) {
      it(`should key build${name} as ${expected}`, () => {
        assert.strictEqual(keyFromExportName(`build${name}`), expected);
      });
    }

    it("should honor a configured factory prefix", () => {
      assert.strictEqual(
        keyFromExportName("build__APIClient", "build__"),
        "apiClient",
      );
    });

    it("should camelCase the whole export name when the prefix does not match", () => {
      assert.strictEqual(keyFromExportName("APIClient"), "apiClient");
    });
  });

  describe("When the same name reaches the cradle through either unit kind", () => {
    for (const [name, expected] of CASES) {
      it(`should agree on ${expected} for class ${name} and factory build${name}`, () => {
        assert.strictEqual(
          keyFromClassName(name),
          keyFromExportName(`build${name}`),
        );
        assert.strictEqual(keyFromClassName(name), expected);
      });
    }
  });

  describe("When a contract's access key is derived", () => {
    it("should use the same rule, so convention default election can match an implementation key", () => {
      // A contract named `APIClient` supplied by `buildAPIClient` (or `class APIClient`) must reach
      // the cradle under ONE spelling: the access key and the implementation key are both
      // `apiClient`, so the convention default matches and no second alias is emitted.
      assert.strictEqual(
        contractNameToDefaultRegistrationKey("APIClient"),
        "apiClient",
      );
      assert.strictEqual(
        contractNameToDefaultRegistrationKey("APIClient"),
        keyFromExportName("buildAPIClient"),
      );
      assert.strictEqual(
        contractNameToDefaultRegistrationKey("MediaStorage"),
        "mediaStorage",
      );
    });
  });

  describe("When a file name is camelCased for the loadModules migration warning", () => {
    it("should split on separators the way Awilix loadModules does", () => {
      assert.strictEqual(awilixCamelCase("s3-media-storage"), "s3MediaStorage");
      assert.strictEqual(awilixCamelCase("media_storage"), "mediaStorage");
      assert.strictEqual(awilixCamelCase("storage"), "storage");
    });
  });

  describe("When ioc.config sets a registration name for the implementation", () => {
    it("should take precedence over the camelCased class name", () => {
      assert.strictEqual(
        resolveRegistrationKeyForClass(
          "S3MediaStorage",
          "blobStore",
          "MediaStorage",
          {
            modulePath: "src/S3MediaStorage.ts",
            contractName: "MediaStorage",
            exportName: "S3MediaStorage",
          },
        ),
        "blobStore",
      );
    });

    it("should take precedence over the camelCased factory export name", () => {
      assert.strictEqual(
        resolveRegistrationKeyForFactory(
          "buildAPIClient",
          "restClient",
          "ApiClient",
          {
            modulePath: "src/buildAPIClient.ts",
            contractName: "ApiClient",
            exportName: "buildAPIClient",
          },
        ),
        "restClient",
      );
    });
  });
});
