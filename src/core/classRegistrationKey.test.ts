/**
 * Class registration keys are camelCased with Awilix's own `formatName: "camelCase"` algorithm, so
 * a codebase migrating off `loadModules` keeps its container keys. These cases pin the policy —
 * especially the acronym handling, which differs from a plain lowercase-first-character rule.
 */
import assert from "node:assert";
import { describe, it } from "node:test";
import {
  awilixCamelCase,
  keyFromClassName,
  keyFromExportName,
  resolveRegistrationKeyForClass,
} from "./resolver.js";

describe("class registration key derivation", () => {
  describe("When the class name has no acronym run", () => {
    it("should lowercase the first word and keep the rest", () => {
      assert.strictEqual(keyFromClassName("MediaStorage"), "mediaStorage");
      assert.strictEqual(keyFromClassName("Logger"), "logger");
    });
  });

  describe("When the class name mixes letters and digits", () => {
    it("should keep the digit inside the leading word", () => {
      assert.strictEqual(keyFromClassName("S3MediaStorage"), "s3MediaStorage");
      assert.strictEqual(keyFromClassName("S3"), "s3");
    });
  });

  describe("When the class name starts with an acronym run", () => {
    it("should split the acronym from the word that follows it", () => {
      // Awilix splits `API|Client`; a lowercase-first-character rule would give `aPIClient`.
      assert.strictEqual(keyFromClassName("APIClient"), "apiClient");
      assert.strictEqual(keyFromClassName("HTTPSProxy"), "httpsProxy");
      assert.strictEqual(keyFromClassName("HTMLParser"), "htmlParser");
    });

    it("should differ from the factory export rule, which only lowercases one character", () => {
      // Documented divergence: factory keys come from the export name after prefix strip, and that
      // rule is unchanged in v3.
      assert.strictEqual(keyFromExportName("buildAPIClient"), "aPIClient");
      assert.notStrictEqual(
        keyFromExportName("buildAPIClient"),
        keyFromClassName("APIClient"),
      );
    });
  });

  describe("When the class name is a bare acronym", () => {
    it("should lowercase the whole run", () => {
      assert.strictEqual(keyFromClassName("API"), "api");
    });
  });

  describe("When a file name is camelCased for the migration warning", () => {
    it("should split on separators the way Awilix loadModules does", () => {
      assert.strictEqual(awilixCamelCase("s3-media-storage"), "s3MediaStorage");
      assert.strictEqual(awilixCamelCase("media_storage"), "mediaStorage");
      assert.strictEqual(awilixCamelCase("storage"), "storage");
    });
  });

  describe("When ioc.config sets a registration name for the implementation", () => {
    it("should take precedence over the camelCased class name", () => {
      assert.strictEqual(
        resolveRegistrationKeyForClass("S3MediaStorage", "blobStore", "MediaStorage", {
          modulePath: "src/S3MediaStorage.ts",
          contractName: "MediaStorage",
          exportName: "S3MediaStorage",
        }),
        "blobStore",
      );
    });
  });
});
