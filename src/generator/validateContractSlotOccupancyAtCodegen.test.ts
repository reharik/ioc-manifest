/**
 * @fileoverview A registration owning its contract's slot key must be the electee.
 *
 * The corner this closes: the slot key means "the elected implementation", but a factory named
 * after its contract registers under that same name, and Awilix holds one registration per name —
 * so that registration owned the key while the election named someone else. Both facts were true
 * and they contradict each other; the demand model's first row ("a contract key resolves the
 * contract's elected default") was false exactly there.
 *
 * The sanctioned shape is unaffected: occupant IS electee, slot and key coinciding by agreement.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ResolvedContractRegistration,
  ResolvedImplementationEntry,
} from "./resolveRegistrationPlan.js";
import { validateContractSlotOccupancyAtCodegen } from "./validateContractSlotOccupancyAtCodegen.js";

const impl = (
  implementationName: string,
  registrationKey = implementationName,
): ResolvedImplementationEntry => ({
  implementationName,
  registrationKey,
  exportName: `build${implementationName.charAt(0).toUpperCase()}${implementationName.slice(1)}`,
  modulePath: `${implementationName}.ts`,
  relImport: `../${implementationName}.js`,
  lifetime: "singleton",
});

const plan = (
  partial: Partial<ResolvedContractRegistration> &
    Pick<
      ResolvedContractRegistration,
      "contractName" | "defaultImplementationName" | "implementations"
    >,
): ResolvedContractRegistration => ({
  contractTypeRelImport: "../contracts.js",
  contractKey: partial.accessKey ?? "mediaStorage",
  accessKey: partial.accessKey ?? "mediaStorage",
  ...partial,
});

const failureMessage = (
  plans: readonly ResolvedContractRegistration[],
): string => {
  try {
    validateContractSlotOccupancyAtCodegen(plans);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  assert.fail("expected the slot-occupancy gate to throw");
};

describe("validateContractSlotOccupancyAtCodegen", () => {
  describe("When a registration occupies the slot key and another is elected", () => {
    const shadowing = [
      plan({
        contractName: "MediaStorage",
        defaultImplementationName: "s3MediaStorage",
        implementations: [
          impl("mediaStorage"),
          impl("s3MediaStorage"),
          impl("localMediaStorage"),
        ],
      }),
    ];

    it("should state the claim naming occupant, contract, slot key and electee", () => {
      const message = failureMessage(shadowing);

      assert.match(
        message,
        /Implementation "mediaStorage" occupies contract "MediaStorage"'s slot key "mediaStorage" but is not the elected default \("s3MediaStorage" is\)/,
      );
    });

    it("should name BOTH exits", () => {
      const message = failureMessage(shadowing);

      // Exit 1: stop shadowing.
      assert.match(message, /Rename the factory so the key stops shadowing the slot/);
      // …with a concrete style exemplar taken from the electee, which is already doing it right.
      assert.match(message, /"buildS3MediaStorage"-style/);
      // Exit 2: make the occupant the electee.
      assert.match(
        message,
        /or elect "mediaStorage" as the default for "MediaStorage"/,
      );
    });

    it("should locate the offender by export and module", () => {
      assert.match(
        failureMessage(shadowing),
        /export "buildMediaStorage" — mediaStorage\.ts/,
      );
    });
  });

  describe("When several contracts are in the state", () => {
    it("should aggregate every offender into one error", () => {
      const message = failureMessage([
        plan({
          contractName: "MediaStorage",
          defaultImplementationName: "s3MediaStorage",
          implementations: [impl("mediaStorage"), impl("s3MediaStorage")],
        }),
        plan({
          contractName: "Logger",
          accessKey: "logger",
          defaultImplementationName: "consoleLogger",
          implementations: [impl("logger"), impl("consoleLogger")],
        }),
      ]);

      assert.match(message, /^\[ioc\] 2 registration\(s\) occupy their contract's slot key/);
      assert.match(message, /"mediaStorage" occupies contract "MediaStorage"/);
      assert.match(message, /"logger" occupies contract "Logger"/);
    });
  });

  describe("When the occupant IS the electee", () => {
    it("should pass — the slot and the key coincide by agreement", () => {
      assert.doesNotThrow(() =>
        validateContractSlotOccupancyAtCodegen([
          plan({
            contractName: "MediaStorage",
            defaultImplementationName: "mediaStorage",
            implementations: [impl("mediaStorage"), impl("s3MediaStorage")],
          }),
        ]),
      );
    });

    it("should pass for the single-implementation convention case", () => {
      assert.doesNotThrow(() =>
        validateContractSlotOccupancyAtCodegen([
          plan({
            contractName: "MediaStorage",
            defaultImplementationName: "mediaStorage",
            implementations: [impl("mediaStorage")],
          }),
        ]),
      );
    });
  });

  describe("When a divergent election involves no shadowing registration", () => {
    it("should pass — the slot key is a genuine alias", () => {
      assert.doesNotThrow(() =>
        validateContractSlotOccupancyAtCodegen([
          plan({
            contractName: "MediaStorage",
            defaultImplementationName: "s3MediaStorage",
            implementations: [
              impl("localMediaStorage"),
              impl("s3MediaStorage"),
            ],
          }),
        ]),
      );
    });
  });

  describe("When the contract backs no slot", () => {
    it("should pass for a grouped contract, which has no key to occupy", () => {
      assert.doesNotThrow(() =>
        validateContractSlotOccupancyAtCodegen([
          plan({
            contractName: "MediaStorage",
            contractDefaultElected: false,
            grouped: true,
            defaultImplementationName: "s3MediaStorage",
            implementations: [impl("mediaStorage"), impl("s3MediaStorage")],
          }),
        ]),
      );
    });
  });

  describe("When a configured accessKey is occupied", () => {
    it("should report against the access key, not the convention key", () => {
      const message = failureMessage([
        plan({
          contractName: "MediaStorage",
          contractKey: "mediaStorage",
          accessKey: "storage",
          defaultImplementationName: "s3MediaStorage",
          implementations: [
            impl("storage"),
            impl("s3MediaStorage"),
          ],
        }),
      ]);

      assert.match(message, /slot key "storage"/);
    });
  });
});
