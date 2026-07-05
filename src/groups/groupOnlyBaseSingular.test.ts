import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import type { IocConfig } from "../config/iocConfig.js";
import { discoverFactories } from "../generator/discoverFactories/discoverFactories.js";
import { buildRegistrationPlan } from "../generator/resolveRegistrationPlan.js";
import { analyzeDemandSupply } from "../generator/analyzeDemandSupply/index.js";
import { buildManifestArtifactSources } from "../generator/writeManifest.js";
import type { IocGroupsConfig } from "./resolveGroupPlan.js";
import { buildGroupPlan } from "./resolveGroupPlan.js";
import { buildBoundedGroupCollectionTypeRefs } from "./boundedGroupCollectionType.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "test-fixtures", "group-only-base");
const projectRoot = path.resolve(__dirname, "..", "..");
const srcDir = path.join(projectRoot, "src");
const generatedDir = path.join(srcDir, "generated");
const contractsPath = path.join(fixtureDir, "contracts.ts");
const factoriesPath = path.join(fixtureDir, "factories.ts");
const scanDirs = [{ absPath: srcDir }];

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

const generateTypesSource = (
  groups: IocGroupsConfig,
  registrations?: IocConfig["registrations"],
): string => {
  const program = makeProgram();
  const config = {
    discovery: { scanDirs: "src" },
    groups,
    ...(registrations !== undefined ? { registrations } : {}),
  } as unknown as IocConfig;

  const { contractMap, acceptedFactories } = discoverFactories(
    [factoriesPath],
    program,
    projectRoot,
    "build",
    { projectRoot, scanDirs, generatedDir },
    config,
  );
  const plans = buildRegistrationPlan(contractMap, config);
  const groupResult = buildGroupPlan(groups, plans, {
    program,
    generatedDir,
    scanDirs,
  });
  const demandSupply = analyzeDemandSupply(acceptedFactories, {
    program,
    projectRoot,
    scanDirs,
    generatedDir,
    groupsManifest: groupResult?.manifest,
  });
  const boundedGroupCollectionTypeRefs = buildBoundedGroupCollectionTypeRefs(
    groupResult?.manifest,
    { program, generatedDir, scanDirs, projectRoot },
  );
  const { typesSource } = buildManifestArtifactSources(
    acceptedFactories,
    plans,
    groupResult?.manifest,
    path.join(generatedDir, "ioc-manifest.ts"),
    "ioc-manifest",
    { demandSupply, boundedGroupCollectionTypeRefs },
  );
  return typesSource;
};

describe("group-only base contract-default singular", () => {
  describe("When a non-generic base is a group base with no elected default", () => {
    it("emits member keys and the group root but not the singular base key", () => {
      const typesSource = generateTypesSource({
        publicReads: { kind: "collection", baseType: "PublicReadServiceBase" },
      });

      // Members keep their own registration keys.
      assert.match(typesSource, /albumRead:\s*PublicReadServiceBase;/);
      assert.match(typesSource, /photoRead:\s*PublicReadServiceBase;/);
      // The group root emits.
      assert.match(
        typesSource,
        /publicReads:\s*ReadonlyArray<PublicReadServiceBase>;/,
      );
      // The phantom singular contract-default key is gone.
      assert.doesNotMatch(
        typesSource,
        /\n\s*publicReadServiceBase:\s*PublicReadServiceBase;/,
      );
      // Regression: a normal single registration keeps its singular.
      assert.match(typesSource, /standaloneService:\s*StandaloneService;/);
    });
  });

  describe("When a generic base is a group base with no elected default", () => {
    it("emits the bounded group array but no bare singular (no TS2314)", () => {
      const typesSource = generateTypesSource({
        publicReads: { kind: "collection", baseType: "PublicReadServiceBase" },
        sweeps: {
          kind: "collection",
          baseType: "SweepStrategy",
          baseTypeArg: "EventShape",
        },
      });

      // Bounded group array emits.
      assert.match(
        typesSource,
        /sweeps:\s*ReadonlyArray<SweepStrategy<EventShape>>;/,
      );
      // The member impl keeps its (valid, instantiated) key.
      assert.match(typesSource, /fastSweep:\s*SweepStrategy</);
      // The bare singular `sweepStrategy: SweepStrategy` (TS2314) is gone.
      assert.doesNotMatch(typesSource, /sweepStrategy:\s*SweepStrategy;/);
    });
  });

  describe("When a group base has an explicitly elected default", () => {
    it("still emits its singular contract-default key", () => {
      const typesSource = generateTypesSource(
        { publicReads: { kind: "collection", baseType: "PublicReadServiceBase" } },
        { PublicReadServiceBase: { albumRead: { default: true } } },
      );

      assert.match(
        typesSource,
        /publicReadServiceBase:\s*PublicReadServiceBase;/,
      );
      // Members and group root still present.
      assert.match(typesSource, /photoRead:\s*PublicReadServiceBase;/);
      assert.match(
        typesSource,
        /publicReads:\s*ReadonlyArray<PublicReadServiceBase>;/,
      );
    });
  });
});
