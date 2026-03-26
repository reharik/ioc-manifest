import assert from "node:assert";
import { describe, it } from "node:test";
import { resolveRegistrationKeyForFactory } from "./resolver.js";

const ctx = (): {
  modulePath: string;
  contractName: string;
  exportName: string;
} => ({
  modulePath: "examples/x.ts",
  contractName: "Foo",
  exportName: "buildBar",
});

describe("resolveRegistrationKeyForFactory", () => {
  describe("When ioc.config registrations name is present", () => {
    it("should use it over the conventional export-based key", () => {
      assert.strictEqual(
        resolveRegistrationKeyForFactory("buildSomething", "fromConfig", "Foo", ctx()),
        "fromConfig",
      );
    });
  });

  describe("When ioc.config registrations name is absent", () => {
    it("should fall back to conventional name from export", () => {
      assert.strictEqual(
        resolveRegistrationKeyForFactory(
          "buildAlbumService",
          undefined,
          "Foo",
          ctx(),
        ),
        "albumService",
      );
    });
  });

  describe("When a registration key cannot be determined", () => {
    it("should throw with contract, export, and module path context", () => {
      assert.throws(
        () =>
          resolveRegistrationKeyForFactory(
            "",
            undefined,
            "Foo",
            {
              modulePath: "mod/a.ts",
              contractName: "Foo",
              exportName: "",
            },
          ),
        /mod\/a\.ts/,
      );
    });
  });
});
