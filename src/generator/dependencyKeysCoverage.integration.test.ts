/**
 * What a generated manifest may claim about its own dependency-key coverage.
 *
 * `dependencyKeys` is derived syntactically from a factory's first parameter, so a unit written
 * `(deps: Deps)` records no keys while demanding plenty — and a unit that records no keys because
 * it demands nothing looks exactly the same. The feature export is the only thing that can tell a
 * composing app which of the two it is looking at, and it used to be a CONSTANT: every manifest
 * this generator wrote asserted full coverage, including the ones that did not have it.
 *
 * Two factories, identical but for their parameter, run through the real pipeline. What differs in
 * the output is one token.
 */
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { analyzeDemandSupply } from "./analyzeDemandSupply/index.js";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import { buildRegistrationPlan } from "./resolveRegistrationPlan.js";
import { contractSlotsForPlans } from "./contractSlotKeys.js";
import { buildManifestArtifactSources } from "./writeManifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(
  __dirname,
  "test-fixtures",
  "dependency-keys-coverage",
);
const projectRoot = path.resolve(__dirname, "../..");
const srcDir = path.join(projectRoot, "src");
const generatedDir = path.join(srcDir, "generated");
const scanDirs = [{ absPath: srcDir }];
const manifestOutPath = path.join(generatedDir, "ioc-manifest.ts");

/** Which spelling of `mediaServeController` the run sees. Everything else is held fixed. */
type Spelling = "destructured" | "plain-param";

const generate = (spelling: Spelling): string => {
  const files = [
    path.join(fixtureDir, "contracts.ts"),
    path.join(fixtureDir, "readable.ts"),
    path.join(fixtureDir, `${spelling}.ts`),
  ];
  const program = ts.createProgram({
    rootNames: files,
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });
  const { contractMap, acceptedFactories, scopeRoots } = discoverFactories(
    files,
    program,
    projectRoot,
    "build",
    { projectRoot, scanDirs, generatedDir },
  );
  const plans = buildRegistrationPlan(contractMap, undefined, {
    projectRoot,
    scanDirs,
  });
  const demandSupply = analyzeDemandSupply(acceptedFactories, {
    program,
    projectRoot,
    scanDirs,
    generatedDir,
    scopeRoots,
    contractSlots: contractSlotsForPlans(plans),
  });

  return buildManifestArtifactSources(
    acceptedFactories,
    plans,
    undefined,
    manifestOutPath,
    "ioc-manifest",
    {
      demandSupply,
      registryTypesBuildContext: {
        program,
        generatedDir,
        scanDirs,
        projectRoot,
      },
    },
  ).mainSource;
};

const featureList = (manifestSource: string): readonly string[] => {
  const block = manifestSource.match(
    /export const IOC_MANIFEST_FEATURES = \[([\s\S]*?)\] as const;/,
  )?.[1];
  assert.ok(block !== undefined, "expected a feature export in the manifest");
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
};

describe("generated manifest dependency-key coverage", () => {
  describe("When every unit's deps parameter could be read", () => {
    it("should claim completeness, so a composing app may walk through this package", () => {
      const source = generate("destructured");

      assert.match(source, /dependencyKeys: \["mediaStorage"\],/);
      assert.deepStrictEqual(featureList(source), [
        "dependencyKeys",
        "dependencyKeysComplete",
        "lifetimeSource",
      ]);
    });
  });

  describe("When one unit takes its dependencies as a plain parameter", () => {
    it("should still declare the field but withhold the completeness claim", () => {
      // The live defect: one dependency, non-destructured, no `dependencyKeys` in the emitted
      // metadata — and, before this, a manifest advertising the feature all the same.
      const source = generate("plain-param");

      assert.ok(
        !/dependencyKeys:/.test(source),
        "a non-destructured deps parameter yields no keys to write",
      );
      assert.deepStrictEqual(featureList(source), [
        "dependencyKeys",
        "lifetimeSource",
      ]);
    });
  });

  describe("When the two spellings are compared", () => {
    it("should differ in the coverage token and in nothing else", () => {
      // The units, their keys, their lifetimes and their registration are identical: the ONE thing
      // the parameter spelling changes is how much the manifest is entitled to claim.
      const complete = generate("destructured");
      const incomplete = generate("plain-param");

      const withoutVariance = (source: string): string =>
        source
          .replace(/\s*dependencyKeys: \[[^\]]*\],/g, "")
          .replace(/\s*dependencyContractNames: \[[^\]]*\],/g, "")
          .replace(/(destructured|plain[-_]param)/g, "SPELLING")
          .replace(
            /export const IOC_MANIFEST_FEATURES = \[[\s\S]*?\] as const;/,
            "FEATURES",
          );

      assert.strictEqual(
        withoutVariance(complete),
        withoutVariance(incomplete),
      );
      assert.notStrictEqual(
        featureList(complete).length,
        featureList(incomplete).length,
      );
    });
  });
});
