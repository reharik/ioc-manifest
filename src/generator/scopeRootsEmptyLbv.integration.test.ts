/**
 * Empty-lbv scope roots: one declaration, two spellings, and an opener that takes no argument.
 *
 * `ScopeRoot<IReportRenderer>` and `ScopeRoot<IReportRenderer, Record<string, never>>` declare the
 * same boundary. The claim asserted here is EQUIVALENCE, not mere acceptance: the two fixtures
 * differ by exactly that annotation, and everything the pipeline produces from them — the
 * discovered variant, the verification, the `--discovery` report, the openers, and both emitted
 * artifacts — must be identical, with no reader able to tell which spelling it came from.
 *
 * The second half is the ergonomics the equivalence pays for: an empty declared lbv emits a
 * zero-parameter opener, so a boundary that carries nothing in is opened with `open()` rather than
 * `open({})`.
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
import { buildScopeRootOpeners } from "./scopeRootOpeners.js";
import { resolveExternalsExclusion } from "./scopeRootExternalsExclusion.js";
import {
  buildScopeRootSupplyIndex,
  verifyScopeRoots,
} from "./verifyScopeRoots.js";
import { buildManifestArtifactSources } from "./writeManifest.js";
import {
  buildDiscoveryReport,
  formatDiscoveryReport,
  formatDiscoveryReportJson,
} from "../inspection/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "test-fixtures", "scope-roots-empty-lbv");
const projectRoot = path.resolve(__dirname, "../..");
const srcDir = path.join(projectRoot, "src");
const generatedDir = path.join(srcDir, "generated");
const scanDirs = [{ absPath: srcDir }];
const manifestOutPath = path.join(generatedDir, "ioc-manifest.ts");

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
};

/** The two spellings, as directory names — the ONLY difference between the two fixture files. */
type Spelling = "arity-one" | "arity-two";

/**
 * The pipeline over one spelling, in `generateManifest`'s call order through serialization.
 *
 * Both spellings run the whole thing, rather than a discovery-only comparison: an equivalence that
 * held at discovery and broke at emission would be no equivalence at all.
 */
const generate = (spelling: Spelling) => {
  const files = [
    path.join(fixtureDir, "contracts.ts"),
    path.join(fixtureDir, spelling, "root.ts"),
  ];
  const program = ts.createProgram({
    rootNames: files,
    options: compilerOptions,
  });
  const { contractMap, acceptedFactories, scopeRoots, discoveryFiles } =
    discoverFactories(
      files,
      program,
      projectRoot,
      "build",
      { projectRoot, scanDirs, generatedDir },
      undefined,
      { collectFileRecords: true },
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
  const verification = verifyScopeRoots(scopeRoots, {
    program,
    projectRoot,
    scanDirs,
    acceptedFactories,
    plans,
    externalKeys: demandSupply.externalKeys,
  });
  const openers = buildScopeRootOpeners(scopeRoots, {
    program,
    projectRoot,
    scanDirs,
    generatedDir,
  });
  const exclusion = resolveExternalsExclusion({
    variants: verification.variants,
    demandersByKey: demandSupply.demandersByKey,
    acceptedFactories,
    scopeRoots,
    supplyIndex: buildScopeRootSupplyIndex({
      program,
      projectRoot,
      scanDirs,
      acceptedFactories,
      plans,
    }),
  });
  const sources = buildManifestArtifactSources(
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
      scopeRootOpeners: openers,
      externalsExcludedKeys: new Set(exclusion.excludedKeys),
    },
  );
  const report = buildDiscoveryReport({
    discoveryFiles,
    scopeRoots,
    scopeRootVerification: verification,
    scopeRootSharedUnits: exclusion.sharedSubtreeUnits,
  });

  return {
    scopeRoots,
    demandSupply,
    verification,
    openers,
    sources,
    reportText: formatDiscoveryReport(report, { color: false }),
    reportJson: formatDiscoveryReportJson(report),
  };
};

/**
 * Erases the one difference that is not the annotation: which directory the fixture was read from.
 *
 * Module paths reach the reports and the emitted manifest, so without this the comparison would
 * fail on the fixture layout rather than on anything either spelling produced. Nothing else is
 * rewritten — a difference the annotation caused would survive this untouched.
 */
const sameFixturePath = (value: string): string =>
  value
    .replaceAll("arity-one", "arity-two")
    // The manifest derives a module-import identifier from the path, where `-` becomes `_`.
    .replaceAll("arity_one", "arity_two");

const jsonOf = (value: unknown): string =>
  sameFixturePath(
    JSON.stringify(value, (_key, v: unknown) =>
      typeof v === "string" ? sameFixturePath(v) : v,
    ),
  );

describe("scope roots with an empty declared lbv", () => {
  describe("When the lbv is declared by omission rather than written out", () => {
    const one = generate("arity-one");
    const two = generate("arity-two");

    it("should discover the same variant, declared lbv text included", () => {
      // The record carries no written node for the omitted form, so the reported text is the
      // default's own spelling. Anything else would report syntax rather than what was declared.
      assert.deepStrictEqual(
        one.scopeRoots.map((r) => ({
          contractName: r.contractName,
          variantName: r.variantName,
          exportName: r.exportName,
          lbvTypeText: r.lbvTypeText,
          lifetime: r.lifetime,
        })),
        two.scopeRoots.map((r) => ({
          contractName: r.contractName,
          variantName: r.variantName,
          exportName: r.exportName,
          lbvTypeText: r.lbvTypeText,
          lifetime: r.lifetime,
        })),
      );
      assert.strictEqual(one.scopeRoots[0]?.lbvTypeText, "Record<string, never>");
      // The omitted form genuinely has no node — the equality above is not a synthesized one.
      assert.strictEqual(one.scopeRoots[0]?.lbvTypeNode, undefined);
      assert.ok(two.scopeRoots[0]?.lbvTypeNode !== undefined);
    });

    it("should verify identically, with an ordinary empty declared set", () => {
      assert.strictEqual(jsonOf(one.verification), jsonOf(two.verification));

      const variant = one.verification.variants[0];
      assert.ok(variant);
      assert.deepStrictEqual(variant.declaredKeys, []);
      assert.strictEqual(variant.satisfied, true);
      assert.deepStrictEqual(variant.scopeDemands, []);
      assert.deepStrictEqual(variant.unusedDeclaredKeys, []);
      // `reportClock` is container-supplied and resolves through the parent chain: an empty lbv is
      // not an empty subtree, and nothing about the omitted argument turned a demand into one.
      assert.ok(one.demandSupply.entries.some((e) => e.key === "reportClock"));
    });

    it("should plan the same opener, lbv keys included", () => {
      assert.strictEqual(jsonOf(one.openers), jsonOf(two.openers));
      assert.deepStrictEqual(
        one.openers.map((o) => [o.openerKey, o.lbvMembers.length]),
        [["openPublicReportScope", 0]],
      );
    });

    it("should emit byte-identical artifacts", () => {
      assert.strictEqual(
        sameFixturePath(one.sources.typesSource),
        sameFixturePath(two.sources.typesSource),
      );
      assert.strictEqual(
        sameFixturePath(one.sources.mainSource),
        sameFixturePath(two.sources.mainSource),
      );
      // …and the manifest row carries the empty declared set, from both spellings.
      assert.match(one.sources.mainSource, /lbvKeys: \[\]/);
      assert.match(two.sources.mainSource, /lbvKeys: \[\]/);
    });

    it("should render the same --discovery report", () => {
      assert.strictEqual(
        sameFixturePath(one.reportText),
        sameFixturePath(two.reportText),
      );
      assert.strictEqual(
        sameFixturePath(one.reportJson),
        sameFixturePath(two.reportJson),
      );
    });

    it("should render the empty-lbv row with its declared set, not a blank", () => {
      const row = one.reportText
        .split("\n")
        .find((line) => line.includes("buildPublicReport"));
      assert.ok(row, "expected a report row for the scope root");
      assert.match(row, /\[scope root\]/);
      assert.match(row, /opener: openPublicReportScope/);
      // The row states the declared set rather than leaving the column empty or crashing on the
      // absent node.
      assert.match(row, /lbv: Record<string, never>/);
      assert.match(row, /satisfied/);
    });
  });

  describe("When an opener's variant declares no late-bound values", () => {
    it("should emit a zero-parameter opener type", () => {
      const { sources } = generate("arity-one");

      assert.match(
        sources.typesSource,
        /export type OpenPublicReportScope = \(\) => \{ publicReport: IReportRenderer; dispose: \(\) => Promise<void> \};/,
      );
      // The parameter is gone, not renamed or made optional: there is nothing to pass.
      assert.doesNotMatch(sources.typesSource, /OpenPublicReportScope = \(lbv/);
      assert.ok(!sources.typesSource.includes("Record<string, never>"));
    });

    it("should still emit the opener key and the consumer that injects it", () => {
      const { sources, demandSupply } = generate("arity-one");

      assert.match(
        sources.typesSource,
        /^ {2}openPublicReportScope: OpenPublicReportScope;$/m,
      );
      assert.match(sources.typesSource, /^ {2}reportGateway: IReportGateway;$/m);
      // The consumer's demand resolved to the opener key, and the app is not asked for it.
      assert.deepStrictEqual(
        (demandSupply.demandersByKey.get("openPublicReportScope") ?? []).map(
          (d) => d.exportName,
        ),
        ["buildReportGateway"],
      );
      assert.ok(!demandSupply.externalKeys.includes("openPublicReportScope"));
    });

    it("should keep a non-empty lbv's opener taking its parameter", () => {
      // The change is scoped to the empty case: a declared member still means a declared argument.
      const emissionDir = path.join(__dirname, "test-fixtures", "scope-roots");
      const files = [
        path.join(emissionDir, "deps-contracts.ts"),
        path.join(emissionDir, "opener-consumer.ts"),
      ];
      const program = ts.createProgram({
        rootNames: files,
        options: compilerOptions,
      });
      const { scopeRoots } = discoverFactories(
        files,
        program,
        projectRoot,
        "build",
        { projectRoot, scanDirs, generatedDir },
        undefined,
        { collectFileRecords: true },
      );
      const openers = buildScopeRootOpeners(scopeRoots, {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
      });

      assert.deepStrictEqual(
        openers.map((o) => o.lbvMembers.map((m) => m.key)),
        [["requestId"]],
      );
    });
  });
});
