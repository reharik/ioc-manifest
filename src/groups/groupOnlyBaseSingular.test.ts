import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import type { IocConfig } from "../config/iocConfig.js";
import { discoverFactories } from "../generator/discoverFactories/discoverFactories.js";
import { buildRegistrationPlan } from "../generator/resolveRegistrationPlan.js";
import { contractSlotsForPlans } from "../generator/contractSlotKeys.js";
import { analyzeDemandSupply } from "../generator/analyzeDemandSupply/index.js";
import { buildManifestArtifactSources } from "../generator/writeManifest.js";
import type { IocGroupsConfig } from "./resolveGroupPlan.js";
import { buildGroupPlan } from "./resolveGroupPlan.js";
import { buildBoundedGroupCollectionTypeRefs } from "./boundedGroupCollectionType.js";
import { resolveGroupedContracts } from "./groupedContracts.js";

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
  const grouped = resolveGroupedContracts(
    groups,
    acceptedFactories.map((factory) => ({
      contractName: factory.contractName,
      contractTypeRelImport: factory.contractTypeRelImport,
    })),
    { program, generatedDir, scanDirs },
  );
  const plans = buildRegistrationPlan(contractMap, config, undefined, {
    groupedContractNames: new Set(grouped.byContractName.keys()),
  });
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
    contractSlots: contractSlotsForPlans(plans),
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

describe("grouped contracts are group-only", () => {
  describe("When several implementations return the group base itself", () => {
    it("emits the group root and neither the contract key nor the member keys", () => {
      const typesSource = generateTypesSource({
        publicReads: { kind: "collection", baseType: "PublicReadServiceBase" },
      });

      // The group root is the whole of the family's exposure.
      assert.match(
        typesSource,
        /publicReads:\s*ReadonlyArray<PublicReadServiceBase>;/,
      );
      // No contract key: grouped is categorically slotless, not merely unelected.
      assert.doesNotMatch(
        typesSource,
        /\n\s*publicReadServiceBase:\s*PublicReadServiceBase;/,
      );
      // No member keys either — a collection group's members are individually anonymous.
      assert.doesNotMatch(typesSource, /\n\s*albumRead:/);
      assert.doesNotMatch(typesSource, /\n\s*photoRead:/);
      // Regression: an ungrouped single registration keeps its singular.
      assert.match(typesSource, /standaloneService:\s*StandaloneService;/);
    });
  });

  describe("When a grouped contract has exactly one implementation", () => {
    it("is still slotless — single-impl is the slot's main road, and grouped leaves it", () => {
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
      // `SweepStrategy` has ONE implementation, which would ordinarily elect it a slot outright.
      // Grouped overrides that: no member key, and no contract key.
      assert.doesNotMatch(typesSource, /\n\s*fastSweep:/);
      // The bare singular `sweepStrategy: SweepStrategy` (TS2314) stays gone.
      assert.doesNotMatch(typesSource, /sweepStrategy:\s*SweepStrategy;/);
    });
  });

  describe("When a grouped contract declares default: true anyway", () => {
    it("still emits no contract key — the declaration has no slot to fill", () => {
      const typesSource = generateTypesSource(
        { publicReads: { kind: "collection", baseType: "PublicReadServiceBase" } },
        { PublicReadServiceBase: { albumRead: { default: true } } },
      );

      assert.doesNotMatch(
        typesSource,
        /publicReadServiceBase:\s*PublicReadServiceBase;/,
      );
      assert.doesNotMatch(typesSource, /\n\s*albumRead:/);
      assert.match(
        typesSource,
        /publicReads:\s*ReadonlyArray<PublicReadServiceBase>;/,
      );
    });
  });
});
