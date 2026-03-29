import assert from "node:assert";
import { describe, it } from "node:test";
import { createContainer } from "awilix";
import type {
  IocContractManifest,
  IocGroupsManifest,
  IocModuleNamespace,
} from "../core/manifest.js";
import { registerIocFromManifest } from "./bootstrap.js";
import { isIocResolutionError } from "./iocResolutionError.js";

type CounterService = { counter: number };
type TestCradle = {
  svc: { seed: string };
  counterService: CounterService;
  counters: Record<string, CounterService>;
};

const createManifestForSingleContract = (lifetime: "singleton" | "scoped" | "transient"): IocContractManifest => ({
  Svc: {
    svc: {
      exportName: "buildSvc",
      registrationKey: "svc",
      modulePath: "svc.ts",
      sourceFilePath: "svc.ts",
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
            sourceFilePath: "zero.ts",
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
            sourceFilePath: "svc.ts",
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
      registerIocFromManifest(container, manifest, moduleImports);

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
            sourceFilePath: "knex.ts",
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
      registerIocFromManifest(container, manifest, moduleImports);
      const viaAccess = container.resolve("database") as { driver: string };
      const viaReg = container.resolve("sqliteKnex") as { driver: string };
      assert.strictEqual(viaAccess.driver, "sqlite");
      assert.strictEqual(viaReg.driver, "sqlite");
    });
  });

  describe("When automatic per-contract multi-implementation collection is registered", () => {
    describe("When the contract has multiple implementations", () => {
      it("should resolve the plural collection key to an array ordered by registrationKey with each implementation once", () => {
        const manifest: IocContractManifest = {
          Svc: {
            zImpl: {
              exportName: "buildZ",
              registrationKey: "zReg",
              modulePath: "svc.ts",
              sourceFilePath: "svc.ts",
              relImport: "../svc.js",
              contractName: "Svc",
              implementationName: "zImpl",
              lifetime: "singleton",
              moduleIndex: 0,
              default: true,
            },
            aImpl: {
              exportName: "buildA",
              registrationKey: "aReg",
              modulePath: "svc.ts",
              sourceFilePath: "svc.ts",
              relImport: "../svc.js",
              contractName: "Svc",
              implementationName: "aImpl",
              lifetime: "singleton",
              moduleIndex: 0,
            },
          },
        };
        const moduleImports: readonly IocModuleNamespace[] = [
          {
            buildZ: (): { tag: string } => ({ tag: "z" }),
            buildA: (): { tag: string } => ({ tag: "a" }),
          },
        ];
        const container = createContainer<{
          zReg: { tag: string };
          aReg: { tag: string };
          svc: { tag: string };
          svcs: { tag: string }[];
        }>({ injectionMode: "PROXY" });
        registerIocFromManifest(container, manifest, moduleImports);
        const svcs = container.resolve("svcs") as { tag: string }[];
        assert.ok(Array.isArray(svcs));
        assert.strictEqual(svcs.length, 2);
        assert.deepStrictEqual(
          svcs.map((x) => x.tag),
          ["a", "z"],
        );
      });
    });
  });

  describe("When collection lifetimes are computed from member lifetimes", () => {
    it("should make collection transient if any member is transient", () => {
      let created = 0;
      const manifest: IocContractManifest = {
        CounterService: {
          fast: {
            exportName: "buildFast",
            registrationKey: "fastCounter",
            modulePath: "counter.ts",
            sourceFilePath: "counter.ts",
            relImport: "../counter.js",
            contractName: "CounterService",
            implementationName: "fast",
            lifetime: "transient",
            moduleIndex: 0,
            default: true,
          },
          stable: {
            exportName: "buildStable",
            registrationKey: "stableCounter",
            modulePath: "counter.ts",
            sourceFilePath: "counter.ts",
            relImport: "../counter.js",
            contractName: "CounterService",
            implementationName: "stable",
            lifetime: "singleton",
            moduleIndex: 0,
          },
        },
      };
      const moduleImports: readonly IocModuleNamespace[] = [
        {
          buildFast: (): CounterService => ({ counter: ++created }),
          buildStable: (): CounterService => ({ counter: ++created }),
        },
      ];

      const container = createContainer<TestCradle>({ injectionMode: "PROXY" });
      registerIocFromManifest(container, manifest, moduleImports);
      const first = container.resolve("counterServices") as CounterService[];
      const second = container.resolve("counterServices") as CounterService[];
      assert.notStrictEqual(first, second);
      assert.notStrictEqual(first[0]!.counter, second[0]!.counter);
    });

    it("should make collection scoped when no members are transient and at least one is scoped", () => {
      let created = 0;
      const manifest: IocContractManifest = {
        CounterService: {
          fast: {
            exportName: "buildFast",
            registrationKey: "fastCounter",
            modulePath: "counter.ts",
            sourceFilePath: "counter.ts",
            relImport: "../counter.js",
            contractName: "CounterService",
            implementationName: "fast",
            lifetime: "scoped",
            moduleIndex: 0,
            default: true,
          },
          stable: {
            exportName: "buildStable",
            registrationKey: "stableCounter",
            modulePath: "counter.ts",
            sourceFilePath: "counter.ts",
            relImport: "../counter.js",
            contractName: "CounterService",
            implementationName: "stable",
            lifetime: "singleton",
            moduleIndex: 0,
          },
        },
      };
      const moduleImports: readonly IocModuleNamespace[] = [
        {
          buildFast: (): CounterService => ({ counter: ++created }),
          buildStable: (): CounterService => ({ counter: ++created }),
        },
      ];

      const root = createContainer<TestCradle>({ injectionMode: "PROXY" });
      registerIocFromManifest(root, manifest, moduleImports);
      const scopeA = root.createScope();
      const scopeB = root.createScope();
      const aFirst = scopeA.resolve("counterServices");
      const aSecond = scopeA.resolve("counterServices");
      const bFirst = scopeB.resolve("counterServices");
      assert.strictEqual(aFirst, aSecond);
      assert.notStrictEqual(aFirst, bFirst);
    });

    it("should make collection singleton when all members are singleton", () => {
      const manifest: IocContractManifest = {
        CounterService: {
          fast: {
            exportName: "buildFast",
            registrationKey: "fastCounter",
            modulePath: "counter.ts",
            sourceFilePath: "counter.ts",
            relImport: "../counter.js",
            contractName: "CounterService",
            implementationName: "fast",
            lifetime: "singleton",
            moduleIndex: 0,
            default: true,
          },
          stable: {
            exportName: "buildStable",
            registrationKey: "stableCounter",
            modulePath: "counter.ts",
            sourceFilePath: "counter.ts",
            relImport: "../counter.js",
            contractName: "CounterService",
            implementationName: "stable",
            lifetime: "singleton",
            moduleIndex: 0,
          },
        },
      };
      const moduleImports: readonly IocModuleNamespace[] = [
        {
          buildFast: (): CounterService => ({ counter: 1 }),
          buildStable: (): CounterService => ({ counter: 2 }),
        },
      ];

      const root = createContainer<TestCradle>({ injectionMode: "PROXY" });
      registerIocFromManifest(root, manifest, moduleImports);
      const scopeA = root.createScope();
      const scopeB = root.createScope();
      const a = scopeA.resolve("counterServices");
      const b = scopeB.resolve("counterServices");
      assert.strictEqual(a, b);
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
            sourceFilePath: "svc.ts",
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
            sourceFilePath: "svc.ts",
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
      registerIocFromManifest(container, manifest, moduleImports);
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
            sourceFilePath: "primary.ts",
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
            sourceFilePath: "secondary.ts",
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
            sourceFilePath: "widget.ts",
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
      registerIocFromManifest(container, manifest, moduleImports);
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
            sourceFilePath: "local.ts",
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
            sourceFilePath: "remote.ts",
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
        () => registerIocFromManifest(container, manifest, moduleImports),
        /Multiple implementations for contract/,
      );
    });
  });

  describe("When manifest and module imports are inconsistent", () => {
    it("should throw clear errors for missing module imports and non-function exports", () => {
      const missingModuleContainer = createContainer<TestCradle>({
        injectionMode: "PROXY",
      });
      const missingModuleManifest = createManifestForSingleContract("singleton");
      assert.throws(
        () => registerIocFromManifest(missingModuleContainer, missingModuleManifest, []),
        /iocModuleImports\[0\] is missing/,
      );

      const badExportContainer = createContainer<TestCradle>({
        injectionMode: "PROXY",
      });
      assert.throws(
        () =>
          registerIocFromManifest(
            badExportContainer,
            missingModuleManifest,
            [{ buildSvc: "not-a-function" }],
          ),
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
      sourceFilePath: `${partial.implementationName}.ts`,
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
          buildRoot: (deps: { missingLeaf: unknown }): unknown => deps.missingLeaf,
        },
      ];
      const container = createContainer<{ root: unknown }>({
        injectionMode: "PROXY",
      });
      registerIocFromManifest(container, manifest, moduleImports);

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
      registerIocFromManifest(container, manifest, moduleImports);

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
      registerIocFromManifest(container, manifest, moduleImports);

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

  describe("When a groups manifest is provided", () => {
    describe("When the group is a collection", () => {
      it("should resolve implementations in manifest order", () => {
      const manifest: IocContractManifest = {
        A: {
          a: {
            exportName: "buildA",
            registrationKey: "implA",
            modulePath: "a.ts",
            sourceFilePath: "a.ts",
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
            sourceFilePath: "b.ts",
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
        pair: [
          { contractName: "A", registrationKey: "implA" },
          { contractName: "B", registrationKey: "implB" },
        ],
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
      registerIocFromManifest(container, manifest, moduleImports, groups);
      const pair = container.resolve("pair");
      assert.deepStrictEqual(pair.map((x) => x.tag), ["a", "b"]);
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
            sourceFilePath: "a.ts",
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
            sourceFilePath: "b.ts",
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
          a: { contractName: "A", registrationKey: "implA" },
          b: { contractName: "B", registrationKey: "implB" },
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
      registerIocFromManifest(container, manifest, moduleImports, groups);
      const byKey = container.resolve("byKey");
      assert.strictEqual(byKey.a.tag, "a");
      assert.strictEqual(byKey.b.tag, "b");
      });
    });
  });
});
