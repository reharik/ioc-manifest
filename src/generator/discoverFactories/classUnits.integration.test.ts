/**
 * v3 class registration units (stage 3): an exported class with an `implements` clause is a
 * registration unit whose contract site is that clause — the same declared, syntactic identity rule
 * a factory's return annotation obeys. Pins discovery, camelCase key derivation, constructor
 * dependency analysis, group and lifetime-marker participation, coexistence with factories on one
 * contract, and every categorized failure.
 */
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { discoverFactories } from "./discoverFactories.js";
import type { IocConfig } from "../../config/iocConfig.js";
import { buildRegistrationPlan } from "../resolveRegistrationPlan.js";
import { buildGroupPlan } from "../../groups/resolveGroupPlan.js";
import { resolveLifetimeMarkersForFactories } from "../resolveLifetimeMarkers.js";
import { analyzeDemandSupply } from "../analyzeDemandSupply/index.js";
import { warnDivergentClassFileNames } from "../warnDivergentClassFileNames.js";
import { warnUnusableFactoryExports } from "../warnUnusableFactoryExports.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "..", "test-fixtures", "class-units");
const projectRoot = path.resolve(fixtureDir, "../../../..");
const srcDir = path.join(projectRoot, "src");
const generatedDir = path.join(srcDir, "generated");

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
};

const fixture = (name: string): string => path.join(fixtureDir, name);

const discoveryPaths = {
  projectRoot,
  scanDirs: [{ absPath: srcDir }],
  generatedDir,
};

const discover = (files: string[], config?: IocConfig) => {
  const program = ts.createProgram({
    rootNames: files,
    options: compilerOptions,
  });
  const result = discoverFactories(
    files,
    program,
    projectRoot,
    "build",
    discoveryPaths,
    config,
    { collectFileRecords: true },
  );
  return { program, ...result };
};

const captureWarnings = (run: () => void): string[] => {
  const original = console.warn;
  const messages: string[] = [];
  console.warn = (...args: unknown[]): void => {
    messages.push(args.map(String).join(" "));
  };
  try {
    run();
  } finally {
    console.warn = original;
  }
  return messages;
};

describe("class registration units (v3)", () => {
  describe("When an exported class carries an implements clause", () => {
    it("should discover it with the implements type as its contract", () => {
      const { acceptedFactories } = discover([
        fixture("contracts.ts"),
        fixture("S3MediaStorage.ts"),
      ]);

      assert.strictEqual(acceptedFactories.length, 1);
      const unit = acceptedFactories[0]!;
      assert.strictEqual(unit.exportName, "S3MediaStorage");
      assert.strictEqual(unit.unitKind, "class");
      assert.strictEqual(unit.contractName, "MediaStorage");
      assert.strictEqual(unit.discoveredBy, "implements");
      assert.ok(unit.contractDeclAbsPath?.endsWith("contracts.ts"));
    });

    it("should derive the registration key by camelCasing the class name", () => {
      const { acceptedFactories } = discover([
        fixture("contracts.ts"),
        fixture("S3MediaStorage.ts"),
      ]);

      const unit = acceptedFactories[0]!;
      assert.strictEqual(unit.registrationKey, "s3MediaStorage");
      assert.strictEqual(unit.implementationName, "s3MediaStorage");
    });

    it("should camelCase an acronym-leading class name the way Awilix loadModules does", () => {
      const { acceptedFactories } = discover([
        fixture("contracts.ts"),
        fixture("APIClient.ts"),
      ]);

      const unit = acceptedFactories[0]!;
      assert.strictEqual(unit.exportName, "APIClient");
      // Awilix `camelCase` splits `API|Client`, not `A|PIClient` — so the key is `apiClient`,
      // NOT the `aPIClient` a plain lowercase-first-character rule would produce.
      assert.strictEqual(unit.registrationKey, "apiClient");
    });
  });

  describe("When an exported class has no implements clause", () => {
    it("should be ignored silently, with no export-scoped outcome", () => {
      const { acceptedFactories, discoveryFiles } = discover([
        fixture("contracts.ts"),
        fixture("no-implements.ts"),
      ]);

      assert.strictEqual(acceptedFactories.length, 0);
      const exportOutcomes = discoveryFiles
        .flatMap((f) => f.outcomes)
        .filter((o) => o.scope === "export");
      assert.deepStrictEqual(exportOutcomes, []);
    });
  });

  describe("When a class constructor takes one destructured object parameter", () => {
    it("should infer its dependencies through the same path as a factory deps parameter", () => {
      const { acceptedFactories } = discover([
        fixture("contracts.ts"),
        fixture("S3MediaStorage.ts"),
        fixture("RequestAuditorImpl.ts"),
      ]);

      const auditor = acceptedFactories.find(
        (f) => f.exportName === "RequestAuditorImpl",
      );
      assert.ok(auditor);
      assert.deepStrictEqual(auditor.dependencyContractNames, ["MediaStorage"]);
      assert.deepStrictEqual(auditor.dependencyKeys, ["s3MediaStorage"]);
    });

    it("should type the cradle from the constructor deps in demand analysis", () => {
      const { program, acceptedFactories } = discover([
        fixture("contracts.ts"),
        fixture("S3MediaStorage.ts"),
        fixture("RequestAuditorImpl.ts"),
      ]);

      const analysis = analyzeDemandSupply(acceptedFactories, {
        program,
        ...discoveryPaths,
      });

      const supply = analysis.entries.find(
        (e) => e.key === "requestAuditorImpl",
      );
      assert.ok(supply, "class unit must supply its own registration key");
      assert.strictEqual(supply.classification, "local");
      assert.strictEqual(supply.typeRef.typeName, "RequestAuditor");

      const demanded = analysis.entries.find((e) => e.key === "s3MediaStorage");
      assert.ok(demanded);
      assert.strictEqual(demanded.classification, "local");
    });
  });

  describe("When a class contract carries a lifetime marker", () => {
    it("should resolve the marker from the implements clause", () => {
      const { program, acceptedFactories } = discover([
        fixture("contracts.ts"),
        fixture("S3MediaStorage.ts"),
        fixture("RequestAuditorImpl.ts"),
      ]);

      const markers = resolveLifetimeMarkersForFactories(
        acceptedFactories,
        { Scoped: "scoped" },
        { program, projectRoot, scanDirs: discoveryPaths.scanDirs },
      );

      const auditor = acceptedFactories.find(
        (f) => f.exportName === "RequestAuditorImpl",
      )!;
      assert.strictEqual(
        markers.get(`${auditor.modulePath}:${auditor.exportName}`),
        "scoped",
      );

      const storage = acceptedFactories.find(
        (f) => f.exportName === "S3MediaStorage",
      )!;
      assert.strictEqual(
        markers.get(`${storage.modulePath}:${storage.exportName}`),
        undefined,
      );
    });

    it("should apply the marker lifetime in the registration plan", () => {
      const { program, contractMap, acceptedFactories } = discover([
        fixture("contracts.ts"),
        fixture("S3MediaStorage.ts"),
        fixture("RequestAuditorImpl.ts"),
      ]);

      const markerLifetimesByFactoryKey = resolveLifetimeMarkersForFactories(
        acceptedFactories,
        { Scoped: "scoped" },
        { program, projectRoot, scanDirs: discoveryPaths.scanDirs },
      );

      const plans = buildRegistrationPlan(contractMap, undefined, {
        projectRoot,
        scanDirs: discoveryPaths.scanDirs,
        markerLifetimesByFactoryKey,
      });

      const auditorPlan = plans.find((p) => p.contractName === "RequestAuditor");
      assert.ok(auditorPlan);
      assert.strictEqual(auditorPlan.implementations[0]!.lifetime, "scoped");
      assert.strictEqual(
        auditorPlan.implementations[0]!.lifetimeSource,
        "lifetime-marker",
      );
    });
  });

  describe("When a class and a factory implement the same contract", () => {
    it("should elect a default exactly as two factories would", () => {
      const { contractMap } = discover([
        fixture("contracts.ts"),
        fixture("S3MediaStorage.ts"),
        fixture("factory-and-class.ts"),
      ]);

      const impls = contractMap.get("MediaStorage");
      assert.ok(impls);
      assert.deepStrictEqual(
        [...impls.keys()].sort(),
        ["s3MediaStorage", "tapeMediaStorage"],
      );

      const plans = buildRegistrationPlan(
        contractMap,
        {
          discovery: { scanDirs: "src" },
          registrations: {
            MediaStorage: { s3MediaStorage: { default: true } },
          },
        },
        { projectRoot, scanDirs: discoveryPaths.scanDirs },
      );

      const plan = plans.find((p) => p.contractName === "MediaStorage")!;
      assert.strictEqual(plan.defaultImplementationName, "s3MediaStorage");
      const classImpl = plan.implementations.find(
        (i) => i.implementationName === "s3MediaStorage",
      )!;
      assert.strictEqual(classImpl.unitKind, "class");
      const factoryImpl = plan.implementations.find(
        (i) => i.implementationName === "tapeMediaStorage",
      )!;
      assert.strictEqual(factoryImpl.unitKind, undefined);
    });

    it("should report ambiguity identically when neither is elected", () => {
      const { contractMap } = discover([
        fixture("contracts.ts"),
        fixture("S3MediaStorage.ts"),
        fixture("factory-and-class.ts"),
      ]);

      assert.throws(
        () =>
          buildRegistrationPlan(contractMap, undefined, {
            projectRoot,
            scanDirs: discoveryPaths.scanDirs,
          }),
        /MediaStorage/,
      );
    });
  });

  describe("When a class is assignable to a group base type", () => {
    it("should join a collection group alongside factory members", () => {
      const { program, contractMap } = discover([
        fixture("contracts.ts"),
        fixture("channels.ts"),
      ]);

      const plans = buildRegistrationPlan(contractMap, undefined, {
        projectRoot,
        scanDirs: discoveryPaths.scanDirs,
      });

      const groups = buildGroupPlan(
        { channels: { kind: "collection", baseType: "Channel" } },
        plans,
        { program, generatedDir, scanDirs: discoveryPaths.scanDirs },
      );

      const root = groups?.manifest.channels;
      assert.ok(root);
      assert.strictEqual(root.kind, "collection");
      assert.ok(Array.isArray(root.members));
      assert.deepStrictEqual(
        root.members.map((m) => m.registrationKey).sort(),
        ["emailChannelUnit", "smsChannel"],
      );
    });

    it("should join an object group keyed by contract", () => {
      const { program, contractMap } = discover([
        fixture("contracts.ts"),
        fixture("channels.ts"),
      ]);

      const plans = buildRegistrationPlan(contractMap, undefined, {
        projectRoot,
        scanDirs: discoveryPaths.scanDirs,
      });

      const groups = buildGroupPlan(
        { channelsByKind: { kind: "object", baseType: "Channel" } },
        plans,
        { program, generatedDir, scanDirs: discoveryPaths.scanDirs },
      );

      const root = groups?.manifest.channelsByKind;
      assert.ok(root);
      assert.strictEqual(root.kind, "object");
      assert.ok(!Array.isArray(root.members));
      assert.deepStrictEqual(Object.keys(root.members).sort(), [
        "emailChannel",
        "smsChannel",
      ]);
      assert.strictEqual(
        root.members.emailChannel!.registrationKey,
        "emailChannelUnit",
      );
    });
  });

  describe("When a class lists more than one implements contract", () => {
    it("should fail with a hard error naming the class and both contracts", () => {
      assert.throws(
        () =>
          discover([fixture("contracts.ts"), fixture("multi-implements.ts")]),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /class "DualUnit"/);
          assert.match(err.message, /"MediaStorage" and "Auditor"/);
          assert.match(err.message, /classes\["DualUnit"\]\.contract/);
          return true;
        },
      );
    });

    it("should register the configured contract when classes[Class].contract selects one", () => {
      const { acceptedFactories } = discover(
        [fixture("contracts.ts"), fixture("multi-implements.ts")],
        {
          discovery: { scanDirs: "src" },
          classes: { DualUnit: { contract: "Auditor" } },
        },
      );

      assert.strictEqual(acceptedFactories.length, 1);
      assert.strictEqual(acceptedFactories[0]!.contractName, "Auditor");
      assert.strictEqual(acceptedFactories[0]!.registrationKey, "dualUnit");
    });

    it("should fail when the configured contract is not implemented", () => {
      assert.throws(
        () =>
          discover(
            [fixture("contracts.ts"), fixture("multi-implements.ts")],
            {
              discovery: { scanDirs: "src" },
              classes: { DualUnit: { contract: "ApiClient" } },
            },
          ),
        /does not implement/,
      );
    });
  });

  describe("When an abstract class carries an implements clause", () => {
    it("should skip it, recording the contract it declares", () => {
      const { acceptedFactories, discoveryFiles } = discover([
        fixture("contracts.ts"),
        fixture("abstract-base.ts"),
      ]);

      assert.strictEqual(acceptedFactories.length, 0);
      const outcome = discoveryFiles
        .flatMap((f) => f.outcomes)
        .find((o) => o.scope === "export" && o.exportName === "MediaStorageBase");
      assert.ok(outcome);
      assert.strictEqual(outcome.status, "skipped");
      assert.strictEqual(
        "skipReason" in outcome ? outcome.skipReason : undefined,
        "class_abstract",
      );
      assert.strictEqual(
        "contractName" in outcome ? outcome.contractName : undefined,
        "MediaStorage",
      );
    });

    it("should warn when no concrete class registers that contract", () => {
      const { discoveryFiles } = discover([
        fixture("contracts.ts"),
        fixture("abstract-base.ts"),
      ]);

      const warnings = captureWarnings(() =>
        warnUnusableFactoryExports(discoveryFiles),
      );

      assert.strictEqual(warnings.length, 1);
      assert.match(warnings[0]!, /class "MediaStorageBase"/);
      assert.match(
        warnings[0]!,
        /no concrete class in scan range registers MediaStorage/,
      );
    });

    it("should stay silent when a concrete class restates the contract", () => {
      // `abstract class Base implements Contract` with a registering subclass is the documented
      // base-class pattern, not a problem — warning on it trains users to ignore the warning.
      const { acceptedFactories, discoveryFiles } = discover([
        fixture("contracts.ts"),
        fixture("restated-contract.ts"),
      ]);

      assert.deepStrictEqual(
        acceptedFactories.map((f) => f.registrationKey),
        ["restatedStorage"],
      );

      const warnings = captureWarnings(() =>
        warnUnusableFactoryExports(discoveryFiles),
      );
      assert.deepStrictEqual(warnings, []);
    });

    it("should stay silent for a base whose contract a concrete class registers from another file", () => {
      const { discoveryFiles } = discover([
        fixture("contracts.ts"),
        fixture("abstract-base.ts"),
        fixture("S3MediaStorage.ts"),
      ]);

      const warnings = captureWarnings(() =>
        warnUnusableFactoryExports(discoveryFiles),
      );
      assert.deepStrictEqual(warnings, []);
    });
  });

  describe("When a concrete class inherits a contract but declares no implements", () => {
    it("should report a categorized skip naming the class, its base, and the contract", () => {
      const { acceptedFactories, discoveryFiles } = discover([
        fixture("contracts.ts"),
        fixture("inherited-contract.ts"),
      ]);

      assert.deepStrictEqual(acceptedFactories, []);

      const outcome = discoveryFiles
        .flatMap((f) => f.outcomes)
        .find(
          (o) => o.scope === "export" && o.exportName === "InheritedOnlyStorage",
        );
      assert.ok(outcome);
      assert.strictEqual(
        "skipReason" in outcome ? outcome.skipReason : undefined,
        "class_inherited_contract_not_declared",
      );
      assert.strictEqual(
        "contractName" in outcome ? outcome.contractName : undefined,
        "MediaStorage",
      );
      assert.strictEqual(
        "baseClassName" in outcome ? outcome.baseClassName : undefined,
        "InheritingStorageBase",
      );
    });

    it("should walk the whole extends chain to the nearest implements-bearing ancestor", () => {
      const { discoveryFiles } = discover([
        fixture("contracts.ts"),
        fixture("inherited-contract.ts"),
      ]);

      const outcome = discoveryFiles
        .flatMap((f) => f.outcomes)
        .find(
          (o) => o.scope === "export" && o.exportName === "DeepInheritedStorage",
        );
      assert.ok(outcome);
      assert.strictEqual(
        "skipReason" in outcome ? outcome.skipReason : undefined,
        "class_inherited_contract_not_declared",
      );
      assert.strictEqual(
        "baseClassName" in outcome ? outcome.baseClassName : undefined,
        "InheritingStorageBase",
      );
    });

    it("should warn with the fix and never register anything from the walk", () => {
      const { acceptedFactories, discoveryFiles } = discover([
        fixture("contracts.ts"),
        fixture("inherited-contract.ts"),
      ]);

      assert.deepStrictEqual(acceptedFactories, []);

      const warnings = captureWarnings(() =>
        warnUnusableFactoryExports(discoveryFiles),
      );

      const nearMiss = warnings.find((w) =>
        w.includes("inherit a contract but declare no"),
      );
      assert.ok(nearMiss);
      assert.match(nearMiss, /class "InheritedOnlyStorage" extends InheritingStorageBase/);
      assert.match(nearMiss, /Add `implements MediaStorage` to InheritedOnlyStorage/);
      // The design intent, so the diagnostic is not read as a half-built feature.
      assert.match(nearMiss, /never one it inherits/);
    });

    it("should stay silent when the concrete class restates implements", () => {
      const { discoveryFiles } = discover([
        fixture("contracts.ts"),
        fixture("restated-contract.ts"),
      ]);

      const nearMisses = discoveryFiles
        .flatMap((f) => f.outcomes)
        .filter(
          (o) =>
            o.scope === "export" &&
            "skipReason" in o &&
            o.skipReason === "class_inherited_contract_not_declared",
        );
      assert.deepStrictEqual(nearMisses, []);
    });

    it("should stay silent for an ordinary class whose base declares no contract", () => {
      const { discoveryFiles } = discover([
        fixture("contracts.ts"),
        fixture("no-implements.ts"),
      ]);

      const exportOutcomes = discoveryFiles
        .flatMap((f) => f.outcomes)
        .filter((o) => o.scope === "export");
      assert.deepStrictEqual(exportOutcomes, []);
    });
  });

  describe("When an acronym-leading name is camelCased into a key", () => {
    it("should give a factory export the same key the equivalent class would get", () => {
      const { acceptedFactories } = discover([
        fixture("contracts.ts"),
        fixture("acronym-factories.ts"),
      ]);

      const keys = Object.fromEntries(
        acceptedFactories.map((f) => [f.exportName, f.registrationKey]),
      );
      // v2 produced `aPIClient` / `hTTPSProxy` here — one lowercased character after the strip.
      assert.deepStrictEqual(keys, {
        buildAPIClient: "apiClient",
        buildHTTPSProxy: "httpsProxy",
        buildS3MediaStorage: "s3MediaStorage",
      });
      for (const f of acceptedFactories) {
        assert.strictEqual(f.implementationName, f.registrationKey);
      }
    });

    it("should give a class the same keys", () => {
      const { acceptedFactories } = discover([
        fixture("contracts.ts"),
        fixture("APIClient.ts"),
        fixture("HTTPSProxy.ts"),
        fixture("S3MediaStorage.ts"),
      ]);

      const keys = Object.fromEntries(
        acceptedFactories.map((f) => [f.exportName, f.registrationKey]),
      );
      assert.deepStrictEqual(keys, {
        APIClient: "apiClient",
        HTTPSProxy: "httpsProxy",
        S3MediaStorage: "s3MediaStorage",
      });
    });
  });

  describe("When a class constructor is not one destructured object parameter", () => {
    it("should fail with a hard error explaining PROXY-mode injection", () => {
      assert.throws(
        () => discover([fixture("contracts.ts"), fixture("bad-constructor.ts")]),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /class "TwoParamStorage"/);
          assert.match(err.message, /PROXY-mode injection/);
          assert.match(err.message, /CLASSIC-mode injection, which is not supported/);
          return true;
        },
      );
    });
  });

  describe("When a class file stem differs from the class name", () => {
    it("should warn that Awilix loadModules would have used a different key", () => {
      const { acceptedFactories } = discover([
        fixture("contracts.ts"),
        fixture("storage.ts"),
      ]);

      const warnings = captureWarnings(() =>
        warnDivergentClassFileNames(acceptedFactories, undefined),
      );

      assert.strictEqual(warnings.length, 1);
      assert.match(warnings[0]!, /class "LocalMediaStorage"/);
      assert.match(warnings[0]!, /"storage"/);
      assert.match(warnings[0]!, /"localMediaStorage"/);
    });

    it("should stay silent when classes[Class].allowDivergentFileName is set", () => {
      const config: IocConfig = {
        discovery: { scanDirs: "src" },
        classes: { LocalMediaStorage: { allowDivergentFileName: true } },
      };
      const { acceptedFactories } = discover(
        [fixture("contracts.ts"), fixture("storage.ts")],
        config,
      );

      const warnings = captureWarnings(() =>
        warnDivergentClassFileNames(acceptedFactories, config),
      );

      assert.deepStrictEqual(warnings, []);
    });

    it("should stay silent when the file name camelCases to the same key", () => {
      const { acceptedFactories } = discover([
        fixture("contracts.ts"),
        fixture("S3MediaStorage.ts"),
      ]);

      const warnings = captureWarnings(() =>
        warnDivergentClassFileNames(acceptedFactories, undefined),
      );

      assert.deepStrictEqual(warnings, []);
    });
  });

  describe("When inspect tolerates unregisterable units", () => {
    it("should report class failures as categorized outcomes instead of throwing", () => {
      const program = ts.createProgram({
        rootNames: [fixture("contracts.ts"), fixture("multi-implements.ts")],
        options: compilerOptions,
      });
      const { discoveryFiles } = discoverFactories(
        [fixture("contracts.ts"), fixture("multi-implements.ts")],
        program,
        projectRoot,
        "build",
        discoveryPaths,
        undefined,
        { collectFileRecords: true, tolerateInvalidAnnotations: true },
      );

      const outcome = discoveryFiles
        .flatMap((f) => f.outcomes)
        .find((o) => o.scope === "export" && o.exportName === "DualUnit");
      assert.ok(outcome);
      assert.strictEqual(
        "skipReason" in outcome ? outcome.skipReason : undefined,
        "class_multiple_implements",
      );
    });
  });
});
