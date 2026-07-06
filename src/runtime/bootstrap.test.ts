import assert from "node:assert";
import { describe, it } from "node:test";
import { createContainer } from "awilix";
import type {
  IocContractManifest,
  IocGroupsManifest,
  IocModuleNamespace,
} from "../core/manifest.js";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";
import { baseManifest, implMeta } from "../test-support/manifestFixtures.js";
import { registerIocFromManifest } from "./bootstrap.js";
import type { ComposedRegistrationOverrides } from "./composedOverrides.js";
import { isIocResolutionError } from "./iocResolutionError.js";

type CounterService = { counter: number };
type TestCradle = {
  svc: { seed: string };
  counterService: CounterService;
  counters: Record<string, CounterService>;
};

const createManifestForSingleContract = (
  lifetime: "singleton" | "scoped" | "transient",
): IocContractManifest => ({
  Svc: {
    svc: {
      exportName: "buildSvc",
      registrationKey: "svc",
      modulePath: "svc.ts",
      relImport: "../svc.js",
      contractName: "Svc",
      implementationName: "svc",
      lifetime,
      moduleIndex: 0,
      default: true,
    },
  },
});

describe("registerIocFromManifest", () => {
  describe("When factory signatures vary", () => {
    it("should always invoke factories with cradle, including zero-arg and default-param factories", () => {
      let capturedDepsArg: unknown;
      const manifest: IocContractManifest = {
        ZeroArg: {
          zeroArg: {
            exportName: "buildZeroArg",
            registrationKey: "zeroArg",
            modulePath: "zero.ts",
            relImport: "../zero.js",
            contractName: "ZeroArg",
            implementationName: "zeroArg",
            lifetime: "singleton",
            moduleIndex: 0,
            default: true,
          },
        },
        Svc: {
          svc: {
            exportName: "buildSvcWithDefaultParam",
            registrationKey: "svc",
            modulePath: "svc.ts",
            relImport: "../svc.js",
            contractName: "Svc",
            implementationName: "svc",
            lifetime: "singleton",
            moduleIndex: 1,
            default: true,
          },
        },
      };
      const moduleImports: readonly IocModuleNamespace[] = [
        {
          buildZeroArg: (...args: unknown[]): { argsLength: number } => ({
            argsLength: args.length,
          }),
        },
        {
          buildSvcWithDefaultParam: (
            deps: { seed?: string } = {},
          ): { seed: string } => {
            capturedDepsArg = deps;
            return { seed: "ok" };
          },
        },
      ];

      const container = createContainer<
        TestCradle & { zeroArg: { argsLength: number } }
      >({
        injectionMode: "PROXY",
      });
      registerIocFromManifest(container, [
        {
          manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
        contracts: manifest,
        moduleImports,
        },
      ]);

      const zeroArg = container.resolve("zeroArg");
      const svc = container.resolve("svc");
      assert.strictEqual(zeroArg.argsLength, 1);
      assert.strictEqual(svc.seed, "ok");
      assert.strictEqual(capturedDepsArg, container.cradle);
    });
  });

  describe("When manifest metadata sets accessKey for the contract default slot", () => {
    it("should register an alias so resolving accessKey returns the selected default implementation", () => {
      const manifest: IocContractManifest = {
        Knex: {
          sqlite: {
            exportName: "buildSqlite",
            registrationKey: "sqliteKnex",
            modulePath: "knex.ts",
            relImport: "../knex.js",
            contractName: "Knex",
            implementationName: "sqlite",
            lifetime: "singleton",
            moduleIndex: 0,
            default: true,
            accessKey: "database",
          },
        },
      };
      const moduleImports: readonly IocModuleNamespace[] = [
        {
          buildSqlite: (): { driver: string } => ({ driver: "sqlite" }),
        },
      ];
      const container = createContainer<{
        sqliteKnex: { driver: string };
        database: { driver: string };
      }>({ injectionMode: "PROXY" });
      registerIocFromManifest(container, [
        {
          manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
        contracts: manifest,
        moduleImports,
        },
      ]);
      const viaAccess = container.resolve("database") as { driver: string };
      const viaReg = container.resolve("sqliteKnex") as { driver: string };
      assert.strictEqual(viaAccess.driver, "sqlite");
      assert.strictEqual(viaReg.driver, "sqlite");
    });
  });

  describe("When selecting and registering defaults", () => {
    it("should register contract key as an alias to the selected default implementation", () => {
      const manifest: IocContractManifest = {
        Svc: {
          alpha: {
            exportName: "buildAlpha",
            registrationKey: "alphaSvc",
            modulePath: "svc.ts",
            relImport: "../svc.js",
            contractName: "Svc",
            implementationName: "alpha",
            lifetime: "singleton",
            moduleIndex: 0,
          },
          beta: {
            exportName: "buildBeta",
            registrationKey: "betaSvc",
            modulePath: "svc.ts",
            relImport: "../svc.js",
            contractName: "Svc",
            implementationName: "beta",
            lifetime: "singleton",
            moduleIndex: 0,
            default: true,
          },
        },
      };
      const moduleImports: readonly IocModuleNamespace[] = [
        {
          buildAlpha: (): { kind: string } => ({ kind: "alpha" }),
          buildBeta: (): { kind: string } => ({ kind: "beta" }),
        },
      ];
      const container = createContainer<{ svc: { kind: string } }>({
        injectionMode: "PROXY",
      });
      registerIocFromManifest(container, [
        {
          manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
        contracts: manifest,
        moduleImports,
        },
      ]);
      const resolved = container.resolve("svc");
      assert.strictEqual(resolved.kind, "beta");
    });
  });

  describe("When the manifest has multiple implementations and one uses the contract key with no default flag", () => {
    it("should register the contract slot to that implementation", () => {
      const manifest: IocContractManifest = {
        Widget: {
          primaryWidget: {
            exportName: "buildPrimary",
            registrationKey: "primaryWidget",
            modulePath: "primary.ts",
            relImport: "../primary.js",
            contractName: "Widget",
            implementationName: "primaryWidget",
            lifetime: "singleton",
            moduleIndex: 0,
          },
          secondaryWidget: {
            exportName: "buildSecondary",
            registrationKey: "secondaryWidget",
            modulePath: "secondary.ts",
            relImport: "../secondary.js",
            contractName: "Widget",
            implementationName: "secondaryWidget",
            lifetime: "singleton",
            moduleIndex: 0,
          },
          widget: {
            exportName: "buildWidget",
            registrationKey: "widget",
            modulePath: "widget.ts",
            relImport: "../widget.js",
            contractName: "Widget",
            implementationName: "widget",
            lifetime: "singleton",
            moduleIndex: 0,
          },
        },
      };
      const moduleImports: readonly IocModuleNamespace[] = [
        {
          buildPrimary: (): { kind: string } => ({ kind: "primary" }),
          buildSecondary: (): { kind: string } => ({ kind: "secondary" }),
          buildWidget: (): { kind: string } => ({ kind: "conventional" }),
        },
      ];
      const container = createContainer<{ widget: { kind: string } }>({
        injectionMode: "PROXY",
      });
      registerIocFromManifest(container, [
        {
          manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
        contracts: manifest,
        moduleImports,
        },
      ]);
      const resolved = container.resolve("widget");
      assert.strictEqual(resolved.kind, "conventional");
    });
  });

  describe("When the manifest has multiple implementations but no default binding", () => {
    it("should throw an error that names implementations and registration keys", () => {
      const manifest: IocContractManifest = {
        MediaStorage: {
          local: {
            exportName: "buildLocal",
            registrationKey: "localMediaStorage",
            modulePath: "local.ts",
            relImport: "../local.js",
            contractName: "MediaStorage",
            implementationName: "local",
            lifetime: "singleton",
            moduleIndex: 0,
          },
          remote: {
            exportName: "buildRemote",
            registrationKey: "remoteMediaStorage",
            modulePath: "remote.ts",
            relImport: "../remote.js",
            contractName: "MediaStorage",
            implementationName: "remote",
            lifetime: "singleton",
            moduleIndex: 0,
          },
        },
      };
      const moduleImports: readonly IocModuleNamespace[] = [
        {
          buildLocal: (): { kind: string } => ({ kind: "local" }),
          buildRemote: (): { kind: string } => ({ kind: "remote" }),
        },
      ];
      const container = createContainer<{ mediaStorage: { kind: string } }>({
        injectionMode: "PROXY",
      });
      assert.throws(
        () =>
          registerIocFromManifest(container, [
        {
          manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
            contracts: manifest,
            moduleImports,
            },
          ]),
        /Multiple implementations for contract/,
      );
    });
  });

  describe("When manifest and module imports are inconsistent", () => {
    it("should throw clear errors for missing module imports and non-function exports", () => {
      const missingModuleContainer = createContainer<TestCradle>({
        injectionMode: "PROXY",
      });
      const missingModuleManifest =
        createManifestForSingleContract("singleton");
      assert.throws(
        () =>
          registerIocFromManifest(missingModuleContainer, [
            {
              manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
            contracts: missingModuleManifest,
            moduleImports: [],
            },
          ]),
        /iocModuleImports\[0\] is missing/,
      );

      const badExportContainer = createContainer<TestCradle>({
        injectionMode: "PROXY",
      });
      assert.throws(
        () =>
          registerIocFromManifest(badExportContainer, [
            {
              manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
            contracts: missingModuleManifest,
            moduleImports: [{ buildSvc: "not-a-function" }],
            },
          ]),
        /has no callable factory export/,
      );
    });
  });

  describe("When resolution fails while building the graph", () => {
    const meta = (
      partial: Pick<
        IocContractManifest[string][string],
        "exportName" | "registrationKey" | "contractName" | "implementationName"
      > & { moduleIndex?: number; default?: boolean },
    ): IocContractManifest[string][string] => ({
      modulePath: `${partial.implementationName}.ts`,
      relImport: `../${partial.implementationName}.js`,
      lifetime: "singleton",
      moduleIndex: partial.moduleIndex ?? 0,
      default: partial.default ?? true,
      ...partial,
    });

    it("should include the resolution chain when a direct dependency registration is missing", () => {
      const manifest: IocContractManifest = {
        Root: {
          r: meta({
            exportName: "buildRoot",
            registrationKey: "root",
            contractName: "Root",
            implementationName: "r",
          }),
        },
      };
      const moduleImports: readonly IocModuleNamespace[] = [
        {
          buildRoot: (deps: { missingLeaf: unknown }): unknown =>
            deps.missingLeaf,
        },
      ];
      const container = createContainer<{ root: unknown }>({
        injectionMode: "PROXY",
      });
      registerIocFromManifest(container, [
        {
          manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
        contracts: manifest,
        moduleImports,
        },
      ]);

      assert.throws(
        () => container.resolve("root"),
        (err: unknown) => {
          assert.ok(isIocResolutionError(err));
          assert.match(err.message, /Cannot build Root using implementation r/);
          assert.match(err.message, /Resolution chain:/);
          assert.match(err.message, /missingLeaf/);
          assert.match(err.message, /no registered implementation/);
          assert.strictEqual(
            (err.message.match(/Resolution chain:/g) ?? []).length,
            1,
          );
          return true;
        },
      );
    });

    it("should include the full chain when a transitive dependency registration is missing", () => {
      const manifest: IocContractManifest = {
        Root: {
          r: meta({
            exportName: "buildRoot",
            registrationKey: "root",
            contractName: "Root",
            implementationName: "r",
            default: true,
          }),
        },
        LevelA: {
          a: meta({
            exportName: "buildA",
            registrationKey: "levelA",
            contractName: "LevelA",
            implementationName: "a",
          }),
        },
        LevelB: {
          b: meta({
            exportName: "buildB",
            registrationKey: "levelB",
            contractName: "LevelB",
            implementationName: "b",
          }),
        },
      };
      const moduleImports: readonly IocModuleNamespace[] = [
        {
          buildRoot: (deps: { levelA: unknown }): unknown => deps.levelA,
          buildA: (deps: { levelB: unknown }): unknown => deps.levelB,
          buildB: (deps: { missingLeaf: unknown }): unknown => deps.missingLeaf,
        },
      ];
      const container = createContainer<{
        root: unknown;
        levelA: unknown;
        levelB: unknown;
      }>({ injectionMode: "PROXY" });
      registerIocFromManifest(container, [
        {
          manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
        contracts: manifest,
        moduleImports,
        },
      ]);

      assert.throws(
        () => container.resolve("root"),
        (err: unknown) => {
          assert.ok(isIocResolutionError(err));
          assert.match(err.message, /Root \(r\)/);
          assert.match(err.message, /LevelA \(a\)/);
          assert.match(err.message, /LevelB \(b\)/);
          assert.match(err.message, /missingLeaf/);
          assert.match(err.message, /no registered implementation/);
          assert.strictEqual(
            (err.message.match(/Resolution chain:/g) ?? []).length,
            1,
          );
          return true;
        },
      );
    });

    it("should include the resolution chain when a nested factory throws during construction", () => {
      const manifest: IocContractManifest = {
        Root: {
          r: meta({
            exportName: "buildRoot",
            registrationKey: "root",
            contractName: "Root",
            implementationName: "r",
            default: true,
          }),
        },
        LevelA: {
          a: meta({
            exportName: "buildA",
            registrationKey: "levelA",
            contractName: "LevelA",
            implementationName: "a",
          }),
        },
        LevelB: {
          b: meta({
            exportName: "buildB",
            registrationKey: "levelB",
            contractName: "LevelB",
            implementationName: "b",
          }),
        },
      };
      const moduleImports: readonly IocModuleNamespace[] = [
        {
          buildRoot: (deps: { levelA: unknown }): unknown => deps.levelA,
          buildA: (deps: { levelB: unknown }): unknown => deps.levelB,
          buildB: (): unknown => {
            throw new Error("deep failure from level B");
          },
        },
      ];
      const container = createContainer<{
        root: unknown;
        levelA: unknown;
        levelB: unknown;
      }>({ injectionMode: "PROXY" });
      registerIocFromManifest(container, [
        {
          manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
        contracts: manifest,
        moduleImports,
        },
      ]);

      assert.throws(
        () => container.resolve("root"),
        (err: unknown) => {
          assert.ok(isIocResolutionError(err));
          assert.match(err.message, /Cannot build Root using implementation r/);
          assert.match(err.message, /Resolution chain:/);
          assert.match(err.message, /LevelA \(a\)/);
          assert.match(err.message, /LevelB \(b\)/);
          assert.match(err.message, /deep failure from level B/);
          assert.match(err.message, /factory threw while building/);
          assert.strictEqual(
            (err.message.match(/Resolution chain:/g) ?? []).length,
            1,
          );
          assert.ok(
            !err.message.includes("factory threw while building: [ioc]"),
            "nested formatted IoC errors must not be embedded in the leaf line",
          );
          assert.ok(
            !/Cannot build Root[\s\S]*Cannot build Root/.test(err.message),
            "headline must not be duplicated",
          );
          return true;
        },
      );
    });
  });

  describe("When the manifest includes group roots at the top level", () => {
    describe("When the group is a collection", () => {
      it("should resolve implementations in manifest order", () => {
        const manifest: IocContractManifest = {
          A: {
            a: {
              exportName: "buildA",
              registrationKey: "implA",
              modulePath: "a.ts",
              relImport: "../a.js",
              contractName: "A",
              implementationName: "a",
              lifetime: "singleton",
              moduleIndex: 0,
              default: true,
            },
          },
          B: {
            b: {
              exportName: "buildB",
              registrationKey: "implB",
              modulePath: "b.ts",
              relImport: "../b.js",
              contractName: "B",
              implementationName: "b",
              lifetime: "singleton",
              moduleIndex: 1,
              default: true,
            },
          },
        };
        const groups: IocGroupsManifest = {
          pair: {
            kind: "collection",
            baseType: "A",
            baseTypeId: "/fake/A.ts:A",
            members: [
              { contractName: "A", registrationKey: "implA" },
              { contractName: "B", registrationKey: "implB" },
            ],
          },
        };
        const moduleImports: readonly IocModuleNamespace[] = [
          { buildA: (): { tag: string } => ({ tag: "a" }) },
          { buildB: (): { tag: string } => ({ tag: "b" }) },
        ];
        const container = createContainer<{
          implA: { tag: string };
          implB: { tag: string };
          pair: { tag: string }[];
        }>({ injectionMode: "PROXY" });
        registerIocFromManifest(container, [
        {
          manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
          contracts: manifest,
          moduleImports,
          ...groups,
          },
        ]);
        const pair = container.resolve("pair");
        assert.deepStrictEqual(
          pair.map((x) => x.tag),
          ["a", "b"],
        );
      });
    });

    describe("When the group is an object keyed by contract key", () => {
      it("should resolve each property from leaf registrationKey on the cradle", () => {
        const manifest: IocContractManifest = {
          A: {
            a: {
              exportName: "buildA",
              registrationKey: "implA",
              modulePath: "a.ts",
              relImport: "../a.js",
              contractName: "A",
              implementationName: "a",
              lifetime: "singleton",
              moduleIndex: 0,
              default: true,
            },
          },
          B: {
            b: {
              exportName: "buildB",
              registrationKey: "implB",
              modulePath: "b.ts",
              relImport: "../b.js",
              contractName: "B",
              implementationName: "b",
              lifetime: "singleton",
              moduleIndex: 1,
              default: true,
            },
          },
        };
        const groups: IocGroupsManifest = {
          byKey: {
            kind: "object",
            baseType: "A",
            baseTypeId: "/fake/A.ts:A",
            members: {
              a: { contractName: "A", registrationKey: "implA" },
              b: { contractName: "B", registrationKey: "implB" },
            },
          },
        };
        const moduleImports: readonly IocModuleNamespace[] = [
          { buildA: (): { tag: string } => ({ tag: "a" }) },
          { buildB: (): { tag: string } => ({ tag: "b" }) },
        ];
        const container = createContainer<{
          implA: { tag: string };
          implB: { tag: string };
          byKey: { a: { tag: string }; b: { tag: string } };
        }>({ injectionMode: "PROXY" });
        registerIocFromManifest(container, [
        {
          manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
          contracts: manifest,
          moduleImports,
          ...groups,
          },
        ]);
        const byKey = container.resolve("byKey");
        assert.strictEqual(byKey.a.tag, "a");
        assert.strictEqual(byKey.b.tag, "b");
      });
    });
  });

  describe("When composedRegistrationOverrides select default and source", () => {
    it("should register using the overridden default implementation", () => {
      const manifestA = {
        manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
        moduleImports: [{ buildS3: (): { tag: string } => ({ tag: "s3" }) }],
        contracts: {
          MediaStorage: {
            s3: {
              exportName: "buildS3",
              registrationKey: "s3MediaStorage",
              modulePath: "a.ts",
              relImport: "../a.js",
              contractName: "MediaStorage",
              implementationName: "s3",
              lifetime: "singleton" as const,
              moduleIndex: 0,
              default: true,
            },
          },
        },
      };
      const manifestB = {
        manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
        moduleImports: [{ buildMock: (): { tag: string } => ({ tag: "mock" }) }],
        contracts: {
          MediaStorage: {
            mock: {
              exportName: "buildMock",
              registrationKey: "mockMediaStorage",
              modulePath: "b.ts",
              relImport: "../b.js",
              contractName: "MediaStorage",
              implementationName: "mock",
              lifetime: "singleton" as const,
              moduleIndex: 0,
              default: true,
            },
          },
        },
      };
      const overrides: ComposedRegistrationOverrides = {
        contracts: {
          MediaStorage: { defaultImplementation: "mock" },
        },
      };
      const container = createContainer<{
        s3MediaStorage: { tag: string };
        mockMediaStorage: { tag: string };
        mediaStorage: { tag: string };
        mediaStorages: { tag: string }[];
      }>({ injectionMode: "PROXY" });
      registerIocFromManifest(container, [manifestA, manifestB], overrides);
      assert.strictEqual(container.resolve("mediaStorage").tag, "mock");
    });
  });

  describe("When a composed package external is supplied by another manifest", () => {
    it("should resolve the external registration key from the supplying manifest at runtime", () => {
      type Logger = { message: string };
      const loggerImpl: Logger = { message: "supplied-by-lib" };

      const supplier = baseManifest(
        {
          Logger: {
            appLogger: {
              ...implMeta({
                contractName: "Logger",
                implementationName: "appLogger",
                exportName: "buildAppLogger",
                registrationKey: "logger",
                default: true,
              }),
            },
          },
        },
        [{ buildAppLogger: (): Logger => loggerImpl }],
      );

      const consumer = baseManifest(
        {
          Consumer: {
            consumer: {
              ...implMeta({
                contractName: "Consumer",
                implementationName: "consumer",
                exportName: "buildConsumer",
                registrationKey: "consumer",
                moduleIndex: 0,
                default: true,
              }),
            },
          },
        },
        [
          {
            buildConsumer: (deps: { logger: Logger }): { out: string } => ({
              out: deps.logger.message,
            }),
          },
        ],
      );

      const container = createContainer<{
        logger: Logger;
        consumer: { out: string };
      }>({ injectionMode: "PROXY" });

      registerIocFromManifest(container, [supplier, consumer]);
      assert.strictEqual(container.resolve("consumer").out, "supplied-by-lib");
    });
  });

  describe("When a group-only base has no elected default (boot the container)", () => {
    describe("When the base is generic and its narrowed members collapse to ≥2 impls under one contract", () => {
      it("should boot without a 'no default selected' abort and resolve the group to both members", () => {
        // Generic base `DomainEventHandler<T>` narrows to two impls that discovery collapses under
        // the single erased contract name — no default is (or can be) elected.
        const manifest: IocContractManifest = {
          DomainEventHandler: {
            orderHandler: {
              exportName: "buildOrderHandler",
              registrationKey: "orderHandler",
              modulePath: "order.ts",
              relImport: "../order.js",
              contractName: "DomainEventHandler",
              implementationName: "orderHandler",
              lifetime: "singleton",
              moduleIndex: 0,
              group: "handlers",
            },
            paymentHandler: {
              exportName: "buildPaymentHandler",
              registrationKey: "paymentHandler",
              modulePath: "payment.ts",
              relImport: "../payment.js",
              contractName: "DomainEventHandler",
              implementationName: "paymentHandler",
              lifetime: "singleton",
              moduleIndex: 1,
              group: "handlers",
            },
          },
        };
        const groups: IocGroupsManifest = {
          handlers: {
            kind: "collection",
            baseType: "DomainEventHandler",
            baseTypeId: "/fake/DomainEventHandler.ts:DomainEventHandler",
            baseTypeArg: "EventShape",
            members: [
              { contractName: "DomainEventHandler", registrationKey: "orderHandler" },
              { contractName: "DomainEventHandler", registrationKey: "paymentHandler" },
            ],
          },
        };
        const moduleImports: readonly IocModuleNamespace[] = [
          { buildOrderHandler: (): { tag: string } => ({ tag: "order" }) },
          { buildPaymentHandler: (): { tag: string } => ({ tag: "payment" }) },
        ];
        const container = createContainer<{
          orderHandler: { tag: string };
          paymentHandler: { tag: string };
          handlers: { tag: string }[];
        }>({ injectionMode: "PROXY" });

        assert.doesNotThrow(() =>
          registerIocFromManifest(container, [
            {
              manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
              contracts: manifest,
              moduleImports,
              ...groups,
            },
          ]),
        );

        const handlers = container.resolve("handlers");
        assert.deepStrictEqual(
          handlers.map((h) => h.tag),
          ["order", "payment"],
        );
      });
    });

    describe("When the base is non-generic with two direct impls under the base contract", () => {
      it("should boot clean (the untested shape that aborts today)", () => {
        const manifest: IocContractManifest = {
          PublicReadServiceBase: {
            albumRead: {
              exportName: "buildAlbumRead",
              registrationKey: "albumRead",
              modulePath: "album.ts",
              relImport: "../album.js",
              contractName: "PublicReadServiceBase",
              implementationName: "albumRead",
              lifetime: "singleton",
              moduleIndex: 0,
              group: "publicReads",
            },
            photoRead: {
              exportName: "buildPhotoRead",
              registrationKey: "photoRead",
              modulePath: "photo.ts",
              relImport: "../photo.js",
              contractName: "PublicReadServiceBase",
              implementationName: "photoRead",
              lifetime: "singleton",
              moduleIndex: 1,
              group: "publicReads",
            },
          },
        };
        const groups: IocGroupsManifest = {
          publicReads: {
            kind: "collection",
            baseType: "PublicReadServiceBase",
            baseTypeId: "/fake/PublicReadServiceBase.ts:PublicReadServiceBase",
            members: [
              { contractName: "PublicReadServiceBase", registrationKey: "albumRead" },
              { contractName: "PublicReadServiceBase", registrationKey: "photoRead" },
            ],
          },
        };
        const moduleImports: readonly IocModuleNamespace[] = [
          { buildAlbumRead: (): { tag: string } => ({ tag: "album" }) },
          { buildPhotoRead: (): { tag: string } => ({ tag: "photo" }) },
        ];
        const container = createContainer<{
          albumRead: { tag: string };
          photoRead: { tag: string };
          publicReads: { tag: string }[];
        }>({ injectionMode: "PROXY" });

        assert.doesNotThrow(() =>
          registerIocFromManifest(container, [
            {
              manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
              contracts: manifest,
              moduleImports,
              ...groups,
            },
          ]),
        );

        const publicReads = container.resolve("publicReads");
        assert.deepStrictEqual(
          publicReads.map((r) => r.tag),
          ["album", "photo"],
        );
      });
    });

    describe("When a group base explicitly elects a default (default: true)", () => {
      it("should still register the default and stay resolvable by the singular key", () => {
        const manifest: IocContractManifest = {
          PublicReadServiceBase: {
            albumRead: {
              exportName: "buildAlbumRead",
              registrationKey: "albumRead",
              modulePath: "album.ts",
              relImport: "../album.js",
              contractName: "PublicReadServiceBase",
              implementationName: "albumRead",
              lifetime: "singleton",
              moduleIndex: 0,
              group: "publicReads",
              default: true,
            },
            photoRead: {
              exportName: "buildPhotoRead",
              registrationKey: "photoRead",
              modulePath: "photo.ts",
              relImport: "../photo.js",
              contractName: "PublicReadServiceBase",
              implementationName: "photoRead",
              lifetime: "singleton",
              moduleIndex: 1,
              group: "publicReads",
            },
          },
        };
        const groups: IocGroupsManifest = {
          publicReads: {
            kind: "collection",
            baseType: "PublicReadServiceBase",
            baseTypeId: "/fake/PublicReadServiceBase.ts:PublicReadServiceBase",
            members: [
              { contractName: "PublicReadServiceBase", registrationKey: "albumRead" },
              { contractName: "PublicReadServiceBase", registrationKey: "photoRead" },
            ],
          },
        };
        const moduleImports: readonly IocModuleNamespace[] = [
          { buildAlbumRead: (): { tag: string } => ({ tag: "album" }) },
          { buildPhotoRead: (): { tag: string } => ({ tag: "photo" }) },
        ];
        const container = createContainer<{
          albumRead: { tag: string };
          photoRead: { tag: string };
          publicReadServiceBase: { tag: string };
          publicReads: { tag: string }[];
        }>({ injectionMode: "PROXY" });

        registerIocFromManifest(container, [
          {
            manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
            contracts: manifest,
            moduleImports,
            ...groups,
          },
        ]);

        // Singular default slot still resolves to the elected default.
        assert.strictEqual(
          container.resolve("publicReadServiceBase").tag,
          "album",
        );
        // Group still resolves too.
        assert.deepStrictEqual(
          container.resolve("publicReads").map((r) => r.tag),
          ["album", "photo"],
        );
      });
    });

    describe("When a normal (non-group-base) contract has two impls and no default", () => {
      it("should STILL throw — only group bases are exempt from default election", () => {
        const manifest: IocContractManifest = {
          MediaStorage: {
            local: {
              exportName: "buildLocal",
              registrationKey: "localMediaStorage",
              modulePath: "local.ts",
              relImport: "../local.js",
              contractName: "MediaStorage",
              implementationName: "local",
              lifetime: "singleton",
              moduleIndex: 0,
            },
            remote: {
              exportName: "buildRemote",
              registrationKey: "remoteMediaStorage",
              modulePath: "remote.ts",
              relImport: "../remote.js",
              contractName: "MediaStorage",
              implementationName: "remote",
              lifetime: "singleton",
              moduleIndex: 1,
            },
          },
        };
        // A group over an UNRELATED base — MediaStorage is not a group baseType.
        const groups: IocGroupsManifest = {
          somethingElse: {
            kind: "collection",
            baseType: "Unrelated",
            baseTypeId: "/fake/Unrelated.ts:Unrelated",
            members: [],
          },
        };
        const moduleImports: readonly IocModuleNamespace[] = [
          { buildLocal: (): { kind: string } => ({ kind: "local" }) },
          { buildRemote: (): { kind: string } => ({ kind: "remote" }) },
        ];
        const container = createContainer<{ mediaStorage: { kind: string } }>({
          injectionMode: "PROXY",
        });

        assert.throws(
          () =>
            registerIocFromManifest(container, [
              {
                manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
                contracts: manifest,
                moduleImports,
                ...groups,
              },
            ]),
          /Multiple implementations for contract/,
        );
      });
    });
  });

  describe("When a manifest declares an incompatible schema version", () => {
    it("should throw before registering factories", () => {
      const bad = {
        ...baseManifest({
          Only: {
            only: implMeta({
              contractName: "Only",
              implementationName: "only",
            }),
          },
        }),
        manifestSchemaVersion: 1 as unknown as typeof MANIFEST_SCHEMA_VERSION,
      };

      assert.throws(
        () =>
          registerIocFromManifest(createContainer({ injectionMode: "PROXY" }), [
            bad,
          ]),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /Manifest schema version mismatch/);
          return true;
        },
      );
    });
  });
});
