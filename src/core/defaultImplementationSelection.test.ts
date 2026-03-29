import assert from "node:assert";
import { describe, it } from "node:test";
import { selectDefaultImplementationName } from "./defaultImplementationSelection.js";

describe("selectDefaultImplementationName", () => {
  describe("When multiple implementations exist and one is marked default", () => {
    it("should select the explicit default", () => {
      const name = selectDefaultImplementationName("Widget", [
        {
          implementationName: "primaryWidget",
          registrationKey: "primaryWidget",
        },
        {
          implementationName: "secondaryWidget",
          registrationKey: "secondaryWidget",
          default: true,
        },
        {
          implementationName: "widget",
          registrationKey: "widget",
        },
      ]);
      assert.strictEqual(name, "secondaryWidget");
    });
  });

  describe("When multiple implementations exist with no explicit default and one matches the contract key", () => {
    it("should select the conventional default", () => {
      const name = selectDefaultImplementationName("Widget", [
        {
          implementationName: "primaryWidget",
          registrationKey: "primaryWidget",
        },
        {
          implementationName: "secondaryWidget",
          registrationKey: "secondaryWidget",
        },
        {
          implementationName: "widget",
          registrationKey: "widget",
        },
      ]);
      assert.strictEqual(name, "widget");
    });
  });

  describe("When multiple implementations exist with no default and no conventional match", () => {
    it("should throw an ambiguity error", () => {
      assert.throws(
        () =>
          selectDefaultImplementationName("MediaStorage", [
            {
              implementationName: "a",
              registrationKey: "a",
            },
            {
              implementationName: "b",
              registrationKey: "b",
            },
          ]),
        /none is selected as the default/,
      );
    });
  });

  describe("When exactly one implementation exists", () => {
    it("should select it without default or convention flags", () => {
      const name = selectDefaultImplementationName("Only", [
        {
          implementationName: "onlyImpl",
          registrationKey: "customKey",
        },
      ]);
      assert.strictEqual(name, "onlyImpl");
    });
  });
});
