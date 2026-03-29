import assert from "node:assert";
import { describe, it } from "node:test";
import type { IocConfig } from "../config/iocConfig.js";
import type { DiscoveredFactory } from "./types.js";
import {
  buildRegistrationPlan,
  normalizeIocOverride,
} from "./resolveRegistrationPlan.js";

const factory = (
  partial: Pick<DiscoveredFactory, "contractName" | "implementationName"> &
    Partial<DiscoveredFactory>,
): DiscoveredFactory => ({
  exportName: "buildX",
  registrationKey: partial.registrationKey ?? partial.implementationName,
  modulePath: "m.ts",
  relImport: "../../m",
  contractTypeRelImport: "../../contract-types",
  ...partial,
});

const toContractMap = (
  spec: Record<string, DiscoveredFactory[]>,
): Map<string, Map<string, DiscoveredFactory>> => {
  const root = new Map<string, Map<string, DiscoveredFactory>>();
  for (const [contract, list] of Object.entries(spec)) {
    const inner = new Map<string, DiscoveredFactory>();
    for (const f of list) {
      inner.set(f.implementationName, f);
    }
    root.set(contract, inner);
  }
  return root;
};

describe("normalizeIocOverride", () => {
  describe("When override includes name", () => {
    it("should map name to registrationKey and pass through other fields", () => {
      assert.deepStrictEqual(
        normalizeIocOverride({ name: "customKey", lifetime: "scoped" }),
        { registrationKey: "customKey", lifetime: "scoped" },
      );
    });
  });
});

describe("buildRegistrationPlan", () => {
  describe("When the contract has a single implementation", () => {
    it("should select that implementation as default and omit a collection key", () => {
      const map = toContractMap({
        AlbumService: [
          factory({
            contractName: "AlbumService",
            implementationName: "albumService",
            registrationKey: "albumService",
          }),
        ],
      });
      const [plan] = buildRegistrationPlan(map, undefined);
      assert.strictEqual(plan.defaultImplementationName, "albumService");
      assert.strictEqual(plan.collectionKey, undefined);
      assert.strictEqual(plan.contractKey, "albumService");
    });
  });

  describe("When the contract has a single implementation without resolver default flag", () => {
    it("should still select that implementation as default", () => {
      const map = toContractMap({
        Only: [
          factory({
            contractName: "Only",
            implementationName: "onlyImpl",
            registrationKey: "onlyImpl",
          }),
        ],
      });
      const [plan] = buildRegistrationPlan(map, undefined);
      assert.strictEqual(plan.defaultImplementationName, "onlyImpl");
      assert.strictEqual(plan.collectionKey, undefined);
    });
  });

  describe("When multiple implementations exist and one is marked default in discovery", () => {
    it("should select the discovered default", () => {
      const map = toContractMap({
        MediaStorage: [
          factory({
            contractName: "MediaStorage",
            implementationName: "localMediaStorage",
          }),
          factory({
            contractName: "MediaStorage",
            implementationName: "s3MediaStorage",
            default: true,
          }),
        ],
      });
      const [plan] = buildRegistrationPlan(map, undefined);
      assert.strictEqual(plan.defaultImplementationName, "s3MediaStorage");
      assert.strictEqual(plan.collectionKey, "mediaStorages");
    });
  });

  describe("When multiple implementations exist and config sets default on one implementation", () => {
    it("should prefer the configured implementation over a different discovered default", () => {
      const map = toContractMap({
        MediaStorage: [
          factory({
            contractName: "MediaStorage",
            implementationName: "localMediaStorage",
            default: true,
          }),
          factory({
            contractName: "MediaStorage",
            implementationName: "s3MediaStorage",
          }),
        ],
      });
      const config: IocConfig = {
        discovery: { rootDir: "src" },
        registrations: {
          MediaStorage: {
            s3MediaStorage: { default: true },
          },
        },
      };
      const [plan] = buildRegistrationPlan(map, config);
      assert.strictEqual(plan.defaultImplementationName, "s3MediaStorage");
    });
  });

  describe("When config names an unknown contract", () => {
    it("should throw with a helpful message", () => {
      const map = toContractMap({
        Foo: [
          factory({ contractName: "Foo", implementationName: "foo", default: true }),
        ],
      });
      const config: IocConfig = {
        discovery: { rootDir: "src" },
        registrations: { Bar: {} },
      };
      assert.throws(
        () => buildRegistrationPlan(map, config),
        /registrations\["Bar"\].*not discovered/,
      );
    });
  });

  describe("When config sets only lifetime without a default key", () => {
    it("should keep the discovered default implementation", () => {
      const map = toContractMap({
        MediaStorage: [
          factory({
            contractName: "MediaStorage",
            implementationName: "localMediaStorage",
            default: true,
          }),
          factory({
            contractName: "MediaStorage",
            implementationName: "s3MediaStorage",
          }),
        ],
      });
      const config: IocConfig = {
        discovery: { rootDir: "src" },
        registrations: {
          MediaStorage: {
            s3MediaStorage: { lifetime: "transient" },
          },
        },
      };
      const [plan] = buildRegistrationPlan(map, config);
      assert.strictEqual(plan.defaultImplementationName, "localMediaStorage");
      const s3 = plan.implementations.find((i) => i.implementationName === "s3MediaStorage");
      assert.ok(s3);
      assert.strictEqual(s3.lifetime, "transient");
    });
  });

  describe("When config sets lifetime and name on an implementation", () => {
    it("should reflect overrides in the registration plan entries", () => {
      const map = toContractMap({
        MediaStorage: [
          factory({
            contractName: "MediaStorage",
            implementationName: "localMediaStorage",
            default: true,
            lifetime: "singleton",
          }),
        ],
      });
      const config: IocConfig = {
        discovery: { rootDir: "src" },
        registrations: {
          MediaStorage: {
            localMediaStorage: {
              name: "renamedKey",
              lifetime: "transient",
            },
          },
        },
      };
      const [plan] = buildRegistrationPlan(map, config);
      const impl = plan.implementations.find(
        (i) => i.implementationName === "localMediaStorage",
      );
      assert.ok(impl);
      assert.strictEqual(impl.registrationKey, "renamedKey");
      assert.strictEqual(impl.lifetime, "transient");
    });
  });

  describe("When multiple implementations exist", () => {
    it("should include each implementation on the plan and set a plural collection key", () => {
      const map = toContractMap({
        MediaStorage: [
          factory({
            contractName: "MediaStorage",
            implementationName: "localMediaStorage",
          }),
          factory({
            contractName: "MediaStorage",
            implementationName: "s3MediaStorage",
            default: true,
          }),
        ],
      });
      const [plan] = buildRegistrationPlan(map, undefined);
      const keys = new Set(
        plan.implementations.map((i) => i.registrationKey),
      );
      assert.ok(keys.has("localMediaStorage"));
      assert.ok(keys.has("s3MediaStorage"));
      assert.strictEqual(plan.collectionKey, "mediaStorages");
    });
  });

  describe("When resolver metadata overrides the registration key", () => {
    it("should keep the implementation name for config while using the registration key for Awilix", () => {
      const map = toContractMap({
        MediaStorage: [
          factory({
            contractName: "MediaStorage",
            implementationName: "mediaStorage",
            registrationKey: "directMediaStorage",
            default: true,
          }),
        ],
      });
      const [plan] = buildRegistrationPlan(map, undefined);
      assert.strictEqual(plan.implementations[0].registrationKey, "directMediaStorage");
      assert.strictEqual(plan.implementations[0].implementationName, "mediaStorage");
    });
  });

  describe("When multiple implementations are both marked default in discovery", () => {
    it("should throw naming the conflicting factories", () => {
      const map = toContractMap({
        X: [
          factory({
            contractName: "X",
            implementationName: "a",
            default: true,
          }),
          factory({
            contractName: "X",
            implementationName: "b",
            default: true,
          }),
        ],
      });
      assert.throws(
        () => buildRegistrationPlan(map, undefined),
        /multiple implementations marked default: true/,
      );
    });
  });

  describe("When implementations disagree on contract type import source", () => {
    it("should throw", () => {
      const map = toContractMap({
        MediaStorage: [
          factory({
            contractName: "MediaStorage",
            implementationName: "a",
            contractTypeRelImport: "../a/contract",
            default: true,
          }),
          factory({
            contractName: "MediaStorage",
            implementationName: "b",
            contractTypeRelImport: "../b/contract",
          }),
        ],
      });
      assert.throws(
        () => buildRegistrationPlan(map, undefined),
        /disagree on contract type import source/,
      );
    });
  });

  describe("When multiple implementations exist with no default and no config", () => {
    it("should throw describing how to fix the issue", () => {
      const map = toContractMap({
        MediaStorage: [
          factory({
            contractName: "MediaStorage",
            implementationName: "a",
          }),
          factory({
            contractName: "MediaStorage",
            implementationName: "b",
          }),
        ],
      });
      assert.throws(
        () => buildRegistrationPlan(map, undefined),
        /none is selected as the default/,
      );
    });
  });

  describe("When multiple implementations exist with no explicit default and one registration key matches the contract key", () => {
    it("should select that implementation as the default", () => {
      const map = toContractMap({
        Widget: [
          factory({
            contractName: "Widget",
            implementationName: "primaryWidget",
            registrationKey: "primaryWidget",
          }),
          factory({
            contractName: "Widget",
            implementationName: "secondaryWidget",
            registrationKey: "secondaryWidget",
          }),
          factory({
            contractName: "Widget",
            implementationName: "widget",
            registrationKey: "widget",
          }),
        ],
      });
      const [plan] = buildRegistrationPlan(map, undefined);
      assert.strictEqual(plan.defaultImplementationName, "widget");
      assert.strictEqual(plan.contractKey, "widget");
      assert.strictEqual(plan.collectionKey, "widgets");
    });
  });

  describe("When config sets default on two implementations for one contract", () => {
    it("should throw", () => {
      const map = toContractMap({
        MediaStorage: [
          factory({
            contractName: "MediaStorage",
            implementationName: "a",
          }),
          factory({
            contractName: "MediaStorage",
            implementationName: "b",
          }),
        ],
      });
      const config: IocConfig = {
        discovery: { rootDir: "src" },
        registrations: {
          MediaStorage: {
            a: { default: true },
            b: { default: true },
          },
        },
      };
      assert.throws(
        () => buildRegistrationPlan(map, config),
        /At most one default per contract/,
      );
    });
  });

  describe("When config names a discovered implementation that does not exist under a valid contract", () => {
    it("should throw listing discovered implementations", () => {
      const map = toContractMap({
        MediaStorage: [
          factory({
            contractName: "MediaStorage",
            implementationName: "localMediaStorage",
            default: true,
          }),
        ],
      });
      const config: IocConfig = {
        discovery: { rootDir: "src" },
        registrations: {
          MediaStorage: {
            notDiscovered: { lifetime: "transient" },
          },
        },
      };
      assert.throws(
        () => buildRegistrationPlan(map, config),
        /not a discovered implementation/,
      );
    });
  });

  describe("When a non-default implementation uses the contract default slot key in the same contract", () => {
    it("should allow planning without forcing a collision error", () => {
      const map = toContractMap({
        MediaStorage: [
          factory({
            contractName: "MediaStorage",
            implementationName: "mediaStorage",
            registrationKey: "mediaStorage",
          }),
          factory({
            contractName: "MediaStorage",
            implementationName: "s3MediaStorage",
            registrationKey: "s3MediaStorage",
            default: true,
          }),
        ],
      });

      const [plan] = buildRegistrationPlan(map, undefined);

      assert.strictEqual(plan.defaultImplementationName, "s3MediaStorage");
      assert.strictEqual(plan.contractKey, "mediaStorage");
      assert.ok(
        plan.implementations.some((impl) => impl.registrationKey === "mediaStorage"),
      );
    });
  });

  describe("When overrides produce duplicate registration keys", () => {
    it("should throw", () => {
      const map = toContractMap({
        MediaStorage: [
          factory({
            contractName: "MediaStorage",
            implementationName: "a",
            registrationKey: "aKey",
            default: true,
          }),
          factory({
            contractName: "MediaStorage",
            implementationName: "b",
            registrationKey: "bKey",
          }),
        ],
      });
      const config: IocConfig = {
        discovery: { rootDir: "src" },
        registrations: {
          MediaStorage: {
            b: { name: "aKey" },
          },
        },
      };
      assert.throws(
        () => buildRegistrationPlan(map, config),
        /global registration name collision/,
      );
    });
  });

  describe("When an implementation uses a registration key reserved as another contract default slot", () => {
    it("should throw", () => {
      const map = toContractMap({
        Foo: [
          factory({
            contractName: "Foo",
            implementationName: "a",
            registrationKey: "s3",
            default: true,
          }),
          factory({
            contractName: "Foo",
            implementationName: "b",
            registrationKey: "bKey",
          }),
        ],
        Bar: [
          factory({
            contractName: "Bar",
            implementationName: "barImpl",
            registrationKey: "foo",
            default: true,
          }),
        ],
      });
      const config: IocConfig = {
        discovery: { rootDir: "src" },
        registrations: {},
      };
      assert.throws(
        () => buildRegistrationPlan(map, config),
        /reserved as the contract default slot for "Foo"/,
      );
    });
  });

  describe("When an implementation uses a registration key reserved as another contract collection slot", () => {
    it("should throw", () => {
      const map = toContractMap({
        MediaStorage: [
          factory({
            contractName: "MediaStorage",
            implementationName: "a",
            default: true,
          }),
          factory({
            contractName: "MediaStorage",
            implementationName: "b",
          }),
        ],
        Bar: [
          factory({
            contractName: "Bar",
            implementationName: "barImpl",
            registrationKey: "mediaStorages",
            default: true,
          }),
        ],
      });
      const config: IocConfig = {
        discovery: { rootDir: "src" },
        registrations: {},
      };
      assert.throws(
        () => buildRegistrationPlan(map, config),
        /reserved as the collection slot for contract "MediaStorage"/,
      );
    });
  });

  describe("When config overrides name for a discovered implementation", () => {
    it("should expose only the override as the registration key, not the conventional discovered key", () => {
      const map = toContractMap({
        CacheClient: [
          factory({
            contractName: "CacheClient",
            implementationName: "preferredCache",
            registrationKey: "preferredCache",
            default: true,
          }),
        ],
      });
      const config: IocConfig = {
        discovery: { rootDir: "src" },
        registrations: {
          CacheClient: {
            preferredCache: { name: "blah" },
          },
        },
      };
      const [plan] = buildRegistrationPlan(map, config);
      const impl = plan.implementations.find((i) => i.implementationName === "preferredCache");
      assert.ok(impl);
      assert.strictEqual(impl.registrationKey, "blah");
      assert.ok(
        !plan.implementations.some((i) => i.registrationKey === "preferredCache"),
      );
    });
  });
});
