/**
 * Runtime/static parity for the contract slot key.
 *
 * The slot key exists in four places — the emitted cradle, the demand/supply supply set, the
 * scope-root subtree walk, and `registerContractDefaultAliases`'s `aliasTo(elected)` — and the only
 * thing that makes it one key rather than four is that all four derive it the same way. The layers
 * cannot be compared by inspection, because generation reads `ioc.config` while runtime reads the
 * manifest; so this suite derives BOTH from a single fixture and compares the answers.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { createContainer } from "awilix";
import type { IocConfig } from "../config/iocConfig.js";
import { resolveManifestAccessKey } from "../core/contractAccessKey.js";
import { analyzeDemandSupply } from "../generator/analyzeDemandSupply/index.js";
import { contractSlotsForPlans } from "../generator/contractSlotKeys.js";
import { discoverFactories } from "../generator/discoverFactories/discoverFactories.js";
import { buildRegistrationPlan } from "../generator/resolveRegistrationPlan.js";
import { buildManifestArtifactSources } from "../generator/writeManifest.js";
import { parseGeneratedManifestSource } from "../generator/parseGeneratedManifestSource.js";
import { registerIocFromManifest } from "./bootstrap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const fixtureDir = path.join(
  __dirname,
  "..",
  "generator",
  "test-fixtures",
  "contract-slots",
);
const generatedDir = path.join(fixtureDir, "generated");
const scanDirs = [{ absPath: fixtureDir }];

/**
 * The ONE fixture both sides are derived from: two `AuthMiddleware` implementations under distinct
 * keys, with the config electing the one whose name does NOT match the contract — so the slot key
 * is a genuine alias and a wrong derivation on either side is visible rather than coincidental.
 */
const config = {
  registrations: {
    AuthMiddleware: { optionalAuthMiddleware: { default: true } },
  },
} as unknown as IocConfig;

const generate = () => {
  const files = ["contracts.ts", "auth.ts", "pipeline.ts"].map((name) =>
    path.join(fixtureDir, name),
  );
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
  const { contractMap, acceptedFactories } = discoverFactories(
    files,
    program,
    projectRoot,
    "build",
    { projectRoot, scanDirs, generatedDir },
    config,
    { collectFileRecords: true },
  );
  const plans = buildRegistrationPlan(contractMap, config, {
    projectRoot,
    scanDirs,
  });
  const demandSupply = analyzeDemandSupply(acceptedFactories, {
    program,
    projectRoot,
    scanDirs,
    generatedDir,
    contractSlots: contractSlotsForPlans(plans),
  });
  const sources = buildManifestArtifactSources(
    [...acceptedFactories],
    plans,
    undefined,
    path.join(generatedDir, "ioc-manifest.ts"),
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
  );
  return { plans, sources };
};

describe("contract slot key runtime parity", () => {
  it("should register the alias under exactly the key the static layers name", () => {
    const { plans, sources } = generate();

    const staticSlot = contractSlotsForPlans(plans).find(
      (slot) => slot.contractName === "AuthMiddleware",
    )!;

    // The runtime side, read the way `registerIocFromManifest` reads it: off the written manifest.
    const parsed = parseGeneratedManifestSource(
      sources.mainSource,
      path.join(generatedDir, "ioc-manifest.ts"),
    );
    const runtimeAccessKey = resolveManifestAccessKey(
      "AuthMiddleware",
      Object.values(parsed.contracts.AuthMiddleware!),
    );
    const runtimeDefault = Object.values(parsed.contracts.AuthMiddleware!).find(
      (meta) => meta.default === true,
    )!;

    assert.equal(runtimeAccessKey, staticSlot.accessKey);
    assert.equal(
      runtimeDefault.registrationKey,
      staticSlot.electedRegistrationKey,
    );
  });

  it("should resolve the slot key to the elected implementation at runtime", async () => {
    const { sources } = generate();
    const parsed = parseGeneratedManifestSource(
      sources.mainSource,
      path.join(generatedDir, "ioc-manifest.ts"),
    );

    // The manifest generation just wrote, registered against the real fixture modules — so the
    // container under test is the one `ioc generate` + `registerIocFromManifest` would produce.
    const container = createContainer<{
      authMiddleware: { name: string };
      optionalAuthMiddleware: { name: string };
      strictAuthMiddleware: { name: string };
      requestPipeline: { run: (path: string) => string };
    }>();
    registerIocFromManifest(container, [
      {
        manifestSchemaVersion: 3,
        moduleImports: [
          await import("../generator/test-fixtures/contract-slots/auth.js"),
          await import("../generator/test-fixtures/contract-slots/pipeline.js"),
        ],
        contracts: parsed.contracts,
      } as never,
    ]);

    // The slot follows the election…
    assert.equal(container.resolve("authMiddleware").name, "optional");
    // …the implementation key does not…
    assert.equal(container.resolve("strictAuthMiddleware").name, "strict");
    // …and the consumer that demands one of each gets exactly that.
    assert.equal(container.resolve("requestPipeline").run("/x"), "/x|strict:/x");
  });
});
