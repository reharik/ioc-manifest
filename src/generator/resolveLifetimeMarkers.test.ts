import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import {
  factoryLifetimeMarkerKey,
  resolveLifetimeMarkersForFactories,
} from "./resolveLifetimeMarkers.js";
import {
  buildRegistrationPlan,
  type ResolvedContractRegistration,
} from "./resolveRegistrationPlan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "test-fixtures", "lifetime-markers");
const projectRoot = path.resolve(__dirname, "..", "..");
const srcDir = path.join(projectRoot, "src");
const generatedDir = path.join(srcDir, "generated");
const contractsPath = path.join(fixtureDir, "contracts.ts");
const factoriesPath = path.join(fixtureDir, "factories.ts");

const makeProgram = (): ts.Program =>
  ts.createProgram({
    rootNames: [contractsPath, factoriesPath],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });

const runDiscovery = (): {
  acceptedFactories: ReturnType<typeof discoverFactories>["acceptedFactories"];
  contractMap: ReturnType<typeof discoverFactories>["contractMap"];
} => {
  const program = makeProgram();
  const { contractMap, acceptedFactories } = discoverFactories(
    [factoriesPath],
    program,
    projectRoot,
    "build",
    { projectRoot, scanDirs: [{ absPath: srcDir }], generatedDir },
    undefined,
  );
  return { acceptedFactories, contractMap };
};

const resolvePlansWithMarkers = (
  lifetimeMarkers: Record<string, "singleton" | "scoped" | "transient">,
): ResolvedContractRegistration[] => {
  const program = makeProgram();
  const { contractMap, acceptedFactories } = runDiscovery();
  const markerLifetimesByFactoryKey = resolveLifetimeMarkersForFactories(
    acceptedFactories,
    lifetimeMarkers,
    { program, projectRoot, scanDirs: [{ absPath: srcDir }] },
  );
  return buildRegistrationPlan(contractMap, undefined, {
    projectRoot,
    scanDirs: [{ absPath: srcDir }],
    markerLifetimesByFactoryKey,
  });
};

const findImplLifetime = (
  plans: readonly ResolvedContractRegistration[],
  contractName: string,
  implementationName: string,
): string | undefined => {
  const plan = plans.find((p) => p.contractName === contractName);
  const impl = plan?.implementations.find(
    (row) => row.implementationName === implementationName,
  );
  return impl?.lifetime;
};

describe("resolveLifetimeMarkersForFactories", () => {
  describe("When lifetimeMarkers is an empty object", () => {
    it("should perform zero assignability checks and return an empty map", () => {
      const program = makeProgram();
      const { acceptedFactories } = runDiscovery();
      let assignabilityCalls = 0;

      const result = resolveLifetimeMarkersForFactories(
        acceptedFactories,
        {},
        {
          program,
          projectRoot,
          scanDirs: [{ absPath: srcDir }],
          deps: {
            resolveMarkerType: () => {
              throw new Error("resolveMarkerType must not run when markers are empty");
            },
            isAssignableToMarker: () => {
              assignabilityCalls += 1;
              return false;
            },
          },
        },
      );

      assert.equal(assignabilityCalls, 0);
      assert.equal(result.size, 0);
    });
  });

  describe("When lifetimeMarkers is undefined", () => {
    it("should perform zero assignability checks and return an empty map", () => {
      const program = makeProgram();
      const { acceptedFactories } = runDiscovery();
      let assignabilityCalls = 0;

      const result = resolveLifetimeMarkersForFactories(
        acceptedFactories,
        undefined,
        {
          program,
          projectRoot,
          scanDirs: [{ absPath: srcDir }],
          deps: {
            resolveMarkerType: () => {
              throw new Error("resolveMarkerType must not run when markers are undefined");
            },
            isAssignableToMarker: () => {
              assignabilityCalls += 1;
              return false;
            },
          },
        },
      );

      assert.equal(assignabilityCalls, 0);
      assert.equal(result.size, 0);
    });
  });

  describe("When a factory return type extends a marker via inheritance", () => {
    it("should resolve the marker lifetime for that factory", () => {
      const program = makeProgram();
      const { acceptedFactories } = runDiscovery();
      const scopedFactory = acceptedFactories.find(
        (f) => f.exportName === "buildScopedService",
      );
      assert.ok(scopedFactory);

      const result = resolveLifetimeMarkersForFactories(
        acceptedFactories,
        { IScoped: "scoped" },
        { program, projectRoot, scanDirs: [{ absPath: srcDir }] },
      );

      assert.equal(
        result.get(factoryLifetimeMarkerKey(scopedFactory!)),
        "scoped",
      );
    });
  });

  describe("When a factory return type matches no marker", () => {
    it("should omit that factory from the result map", () => {
      const program = makeProgram();
      const { acceptedFactories } = runDiscovery();

      const result = resolveLifetimeMarkersForFactories(
        acceptedFactories,
        { IScoped: "scoped" },
        { program, projectRoot, scanDirs: [{ absPath: srcDir }] },
      );

      const plainFactory = acceptedFactories.find(
        (f) => f.exportName === "buildPlainService",
      );
      assert.ok(plainFactory);
      assert.equal(result.has(factoryLifetimeMarkerKey(plainFactory!)), false);
    });
  });

  describe("When a factory return type extends two markers", () => {
    it("should throw with the full export name and both markers listed", () => {
      const program = makeProgram();
      const { acceptedFactories } = runDiscovery();

      assert.throws(
        () =>
          resolveLifetimeMarkersForFactories(
            acceptedFactories,
            { IScoped: "scoped", ITransient: "transient" },
            { program, projectRoot, scanDirs: [{ absPath: srcDir }] },
          ),
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          assert.match(message, /Factory "buildDualMarked"/);
          assert.match(message, /"IScoped" → scoped/);
          assert.match(message, /"ITransient" → transient/);
          assert.match(
            message,
            /Lifetime is ambiguous\. Either remove one marker from the type's inheritance chain/,
          );
          return true;
        },
      );
    });
  });
});

describe("buildRegistrationPlan with lifetime markers", () => {
  describe("When a marker applies to a factory", () => {
    it("should set lifetime and lifetimeSource from the marker", () => {
      const plans = resolvePlansWithMarkers({ IScoped: "scoped" });
      const plan = plans.find((p) => p.contractName === "ScopedService");
      assert.ok(plan);
      const impl = plan.implementations.find(
        (row) => row.implementationName === "scopedService",
      );
      assert.ok(impl);
      assert.equal(impl.lifetime, "scoped");
      assert.equal(impl.lifetimeSource, "lifetime-marker");
    });
  });

  describe("When per-impl lifetime overrides a marker", () => {
    it("should prefer factory-config over lifetime-marker", () => {
      const program = makeProgram();
      const { contractMap, acceptedFactories } = runDiscovery();
      const markerLifetimesByFactoryKey = resolveLifetimeMarkersForFactories(
        acceptedFactories,
        { IScoped: "scoped" },
        { program, projectRoot, scanDirs: [{ absPath: srcDir }] },
      );
      const plans = buildRegistrationPlan(
        contractMap,
        {
          discovery: { scanDirs: "src" },
          registrations: {
            ScopedService: {
              scopedService: { lifetime: "transient" },
            },
          },
        },
        {
          projectRoot,
          scanDirs: [{ absPath: srcDir }],
          markerLifetimesByFactoryKey,
        },
      );
      const plan = plans.find((row) => row.contractName === "ScopedService");
      const impl = plan?.implementations[0];
      assert.ok(impl);
      assert.equal(impl.lifetime, "transient");
      assert.equal(impl.lifetimeSource, "factory-config");
    });
  });

  describe("When a marker and discovery-root scope both apply", () => {
    it("should prefer lifetime-marker over discovery-root scope", () => {
      const program = makeProgram();
      const { contractMap, acceptedFactories } = runDiscovery();
      const scanAbs = path.join(projectRoot, "src");
      const markerLifetimesByFactoryKey = resolveLifetimeMarkersForFactories(
        acceptedFactories,
        { IScoped: "scoped" },
        { program, projectRoot, scanDirs: [{ absPath: scanAbs }] },
      );
      const plans = buildRegistrationPlan(contractMap, undefined, {
        projectRoot,
        scanDirs: [{ absPath: scanAbs, scope: "transient" }],
        markerLifetimesByFactoryKey,
      });
      assert.equal(
        findImplLifetime(plans, "ScopedService", "scopedService"),
        "scoped",
      );
      const plan = plans.find((p) => p.contractName === "ScopedService");
      const impl = plan?.implementations.find(
        (row) => row.implementationName === "scopedService",
      );
      assert.equal(impl?.lifetimeSource, "lifetime-marker");
    });
  });
});
