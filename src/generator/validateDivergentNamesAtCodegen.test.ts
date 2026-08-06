import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IocConfig } from "../config/iocConfig.js";
import type {
  ResolvedContractRegistration,
  ResolvedImplementationEntry,
} from "./resolveRegistrationPlan.js";
import { validateDivergentNamesAtCodegen } from "./validateDivergentNamesAtCodegen.js";

const makeImplementation = (
  implementationName: string,
  registrationKey: string,
): ResolvedImplementationEntry => ({
  implementationName,
  registrationKey,
  exportName: `build${implementationName.charAt(0).toUpperCase()}${implementationName.slice(1)}`,
  modulePath: "factories.ts",
  relImport: "./factories.js",
  lifetime: "singleton",
});

const makePlan = (
  contractName: string,
  implementationKeys: readonly (readonly [string, string])[],
  overrides?: Partial<ResolvedContractRegistration>,
): ResolvedContractRegistration => {
  const contractKey =
    contractName.charAt(0).toLowerCase() + contractName.slice(1);
  return {
    contractName,
    contractTypeRelImport: "./contracts.js",
    contractKey,
    accessKey: contractKey,
    defaultImplementationName: implementationKeys[0]![0],
    implementations: implementationKeys.map(([name, key]) =>
      makeImplementation(name, key),
    ),
    ...overrides,
  };
};

const makeConfig = (
  registrations?: IocConfig["registrations"],
): IocConfig => ({
  discovery: { scanDirs: "src" },
  ...(registrations !== undefined ? { registrations } : {}),
});

const captureWarnings = (fn: () => void): string[] => {
  const warnings: string[] = [];
  const prevWarn = console.warn;
  console.warn = (msg: unknown) => {
    warnings.push(String(msg));
  };
  try {
    fn();
  } finally {
    console.warn = prevWarn;
  }
  return warnings;
};

describe("validateDivergentNamesAtCodegen", () => {
  describe("When a single implementation's registration key matches the contract access key", () => {
    it("should not warn", () => {
      const plans = [
        makePlan("MediaStorage", [["mediaStorage", "mediaStorage"]]),
      ];

      const warnings = captureWarnings(() => {
        validateDivergentNamesAtCodegen(plans, undefined, "build");
      });

      assert.deepStrictEqual(warnings, []);
    });
  });

  describe("When a single implementation's registration key diverges from the contract access key", () => {
    it("should warn naming both keys and the suggested fixes", () => {
      const plans = [
        makePlan("CreateMediaUpload", [
          ["createMediaItemUpload", "createMediaItemUpload"],
        ]),
      ];

      const warnings = captureWarnings(() => {
        validateDivergentNamesAtCodegen(plans, undefined, "build__");
      });

      assert.strictEqual(warnings.length, 1);
      assert.match(warnings[0]!, /"CreateMediaUpload"/);
      assert.match(warnings[0]!, /"createMediaItemUpload"/);
      assert.match(warnings[0]!, /"createMediaUpload"/);
      assert.match(warnings[0]!, /"build__CreateMediaUpload"/);
      assert.match(warnings[0]!, /allowDivergentName/);
    });
  });

  describe("When the divergence is suppressed with $contract.allowDivergentName", () => {
    it("should not warn", () => {
      const plans = [
        makePlan("CreateMediaUpload", [
          ["createMediaItemUpload", "createMediaItemUpload"],
        ]),
      ];
      const config = makeConfig({
        CreateMediaUpload: { $contract: { allowDivergentName: true } },
      });

      const warnings = captureWarnings(() => {
        validateDivergentNamesAtCodegen(plans, config, "build__");
      });

      assert.deepStrictEqual(warnings, []);
    });
  });

  describe("When the contract access key is explicitly configured", () => {
    it("should not warn (the second name is a deliberate choice)", () => {
      const plans = [
        makePlan("Knex", [["knex", "knex"]], { accessKey: "database" }),
      ];
      const config = makeConfig({
        Knex: { $contract: { accessKey: "database" } },
      });

      const warnings = captureWarnings(() => {
        validateDivergentNamesAtCodegen(plans, config, "build");
      });

      assert.deepStrictEqual(warnings, []);
    });
  });

  describe("When a contract has multiple implementations", () => {
    it("should not warn even though implementation keys diverge from the access key", () => {
      const plans = [
        makePlan("MediaStorage", [
          ["localMediaStorage", "localMediaStorage"],
          ["s3MediaStorage", "s3MediaStorage"],
        ]),
      ];

      const warnings = captureWarnings(() => {
        validateDivergentNamesAtCodegen(plans, undefined, "build");
      });

      assert.deepStrictEqual(warnings, []);
    });
  });

  describe("When the contract is a group base with no elected default", () => {
    it("should not warn (no singular default-slot key is emitted)", () => {
      const plans = [
        makePlan("Channel", [["emailChannel", "emailChannel"]], {
          contractDefaultElected: false,
        }),
      ];

      const warnings = captureWarnings(() => {
        validateDivergentNamesAtCodegen(plans, undefined, "build");
      });

      assert.deepStrictEqual(warnings, []);
    });
  });

  describe("When the divergent contract is a member of a group (not the base type)", () => {
    it("should still warn — only the group base itself is exempt", () => {
      const plans = [
        makePlan("CreateMediaUpload", [
          ["createMediaItemUpload", "createMediaItemUpload"],
        ]),
      ];
      const config: IocConfig = {
        discovery: { scanDirs: "src" },
        groups: {
          writeServices: { kind: "object", baseType: "WriteServiceBase" },
        },
      };

      const warnings = captureWarnings(() => {
        validateDivergentNamesAtCodegen(plans, config, "build__");
      });

      assert.strictEqual(warnings.length, 1);
      assert.match(warnings[0]!, /"CreateMediaUpload"/);
    });
  });

  describe("When multiple contracts diverge", () => {
    it("should warn once per divergent contract", () => {
      const plans = [
        makePlan("CreateMediaUpload", [
          ["createMediaItemUpload", "createMediaItemUpload"],
        ]),
        makePlan("MediaStorage", [["s3MediaStorage", "s3MediaStorage"]]),
        makePlan("HttpClient", [["httpClient", "httpClient"]]),
      ];

      const warnings = captureWarnings(() => {
        validateDivergentNamesAtCodegen(plans, undefined, "build");
      });

      assert.strictEqual(warnings.length, 2);
      assert.match(warnings[0]!, /"CreateMediaUpload"/);
      assert.match(warnings[1]!, /"MediaStorage"/);
    });
  });
});
