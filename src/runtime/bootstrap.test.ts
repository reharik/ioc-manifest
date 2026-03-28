import assert from "node:assert";
import { describe, it } from "node:test";
import { createContainer } from "awilix";
import type { IocContractManifest, IocModuleNamespace } from "../core/manifest.js";
import { registerIocFromManifest } from "./bootstrap.js";

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
      const first = container.resolve("counterServices");
      const second = container.resolve("counterServices");
      assert.notStrictEqual(first, second);
      assert.notStrictEqual(first.fast.counter, second.fast.counter);
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
        /has 2 implementations/,
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
});
