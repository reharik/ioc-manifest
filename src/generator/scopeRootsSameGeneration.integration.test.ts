/**
 * Scope-root openers referenced in the SAME generation that first emits them.
 *
 * The adoption path is one edit: a factory gains its `ScopeRoot` annotation and a consumer gains the
 * opener dep together, and the next `gen` has to succeed. That run reads a generated file that
 * predates both — or, on a cold start, none at all — so the opener alias the consumer names cannot
 * be resolved from the import's target. It is resolved against the opener PLAN instead: the set of
 * names this generation's discovered scope roots will emit, which is the same authority the emitter
 * writes from.
 *
 * The other side is pinned here too: a name that is opener-SHAPED but in no variant's plan is stale
 * generated output, and the tolerance must not swallow it.
 */
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { analyzeDemandSupply } from "./analyzeDemandSupply/index.js";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import { buildRegistrationPlan } from "./resolveRegistrationPlan.js";
import { buildScopeRootOpeners } from "./scopeRootOpeners.js";
import { resolveExternalsExclusion } from "./scopeRootExternalsExclusion.js";
import {
  buildScopeRootSupplyIndex,
  verifyScopeRoots,
} from "./verifyScopeRoots.js";
import { buildManifestArtifactSources } from "./writeManifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const srcDir = path.join(projectRoot, "src");
const generatedDir = path.join(srcDir, "generated");
const scanDirs = [{ absPath: srcDir }];
const manifestOutPath = path.join(generatedDir, "ioc-manifest.ts");

/** Fixtures whose `generated/` stand-in predates the scope root (no opener key, no opener alias). */
const warmDir = path.join(
  __dirname,
  "test-fixtures",
  "scope-roots-same-generation",
);
/** Fixtures with NO `generated/` directory at all — the cold start. */
const coldDir = path.join(__dirname, "test-fixtures", "scope-roots-cold-start");

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
};

/**
 * The real generation pipeline over a fixture set, in `generateManifest`'s call order, through
 * artifact serialization — so "generation succeeds in one run" is asserted against what `gen`
 * actually does, not an approximation of it.
 */
const generate = (dir: string, names: string[]) => {
  const files = names.map((name) => path.join(dir, name));
  const program = ts.createProgram({
    rootNames: files,
    options: compilerOptions,
  });
  const { contractMap, acceptedFactories, scopeRoots } = discoverFactories(
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

  return { scopeRoots, demandSupply, openers, sources };
};

/** Who demanded a key, sorted — the walk's order is file order and carries no meaning here. */
const demanderNames = (
  demandSupply: ReturnType<typeof generate>["demandSupply"],
  key: string,
): string[] =>
  (demandSupply.demandersByKey.get(key) ?? [])
    .map((d) => d.exportName)
    .sort((a, b) => a.localeCompare(b));

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

describe("scope-root openers referenced in the generation that emits them", () => {
  describe("When a root and its first consumer arrive in the same edit", () => {
    it("should generate in one run against output that predates the opener", () => {
      const { openers, demandSupply } = generate(warmDir, [
        "contracts.ts",
        "root-and-alias-consumer.ts",
      ]);

      // The generated stand-in next door exports neither `openAuthServiceScope` nor its alias. The
      // plan does, and that is what the consumer's `OpenAuthServiceScope` resolved against.
      assert.deepStrictEqual(
        openers.map((o) => [o.variantName, o.openerKey]),
        [["authService", "openAuthServiceScope"]],
      );
      assert.deepStrictEqual(
        demanderNames(demandSupply, "openAuthServiceScope"),
        ["buildAuthController"],
      );
    });

    it("should emit the opener and the consumer's own registration together", () => {
      const { sources } = generate(warmDir, [
        "contracts.ts",
        "root-and-alias-consumer.ts",
      ]);

      assert.match(sources.typesSource, /^ {2}authController: AuthController;$/m);
      assert.match(
        sources.typesSource,
        /export type OpenAuthServiceScope = \(lbv: \{ requestId: string \}\) => \{ authService: IAuthService; dispose: \(\) => Promise<void> \};/,
      );
      assert.match(sources.mainSource, /buildAuthController/);
      // Nothing was read out of the file that predates the root.
      assert.ok(!sources.typesSource.includes("StaleClock"));
    });

    it("should emit the consumer's opener dep by reference to the alias", () => {
      const { sources, demandSupply } = generate(warmDir, [
        "contracts.ts",
        "root-and-alias-consumer.ts",
      ]);

      // One cradle property, naming the alias, written by emission rather than by the demand walk…
      const propertyLines = sources.typesSource
        .split("\n")
        .filter((line) => /^ {2}openAuthServiceScope:/.test(line));
      assert.deepStrictEqual(propertyLines, [
        "  openAuthServiceScope: OpenAuthServiceScope;",
      ]);
      assert.ok(
        !demandSupply.entries.some((e) => e.key === "openAuthServiceScope"),
      );
      // …and the app is never asked to supply a scope opener it cannot build.
      assert.ok(!demandSupply.externalKeys.includes("openAuthServiceScope"));
      // The signature is printed once, in the alias declaration — never expanded at the demand site.
      assert.strictEqual(
        sources.typesSource.split("dispose: () => Promise<void>").length - 1,
        1,
      );
    });

    it("should resolve the opener through a deps type the developer composed", () => {
      // An intersection has no single member list, so the property's written type node is reachable
      // only through its own declaration. Without it the property reaches the checker and the
      // not-yet-emitted alias fails the run — the exact consuming-app reproduction.
      const { demandSupply, sources } = generate(warmDir, [
        "contracts.ts",
        "root-and-alias-consumer.ts",
        "composed-deps-consumer.ts",
      ]);

      assert.deepStrictEqual(
        demanderNames(demandSupply, "openAuthServiceScope"),
        ["buildAuthController", "buildComposedController"],
      );
      assert.match(
        sources.typesSource,
        /^ {2}composedController: ComposedController;$/m,
      );
      // The composed deps type's OTHER property is still an ordinary resolved demand.
      assert.match(sources.typesSource, /^ {2}auditClock: IClock;$/m);
    });

    it("should resolve the indexed spelling against a cradle that predates the key", () => {
      const { demandSupply, sources } = generate(warmDir, [
        "contracts.ts",
        "root-and-alias-consumer.ts",
        "indexed-consumer.ts",
      ]);

      // `IocGeneratedCradle` exists in the stand-in; `openAuthServiceScope` is not one of its
      // properties. The key is read off the source text, so the run does not care.
      assert.deepStrictEqual(
        demanderNames(demandSupply, "openAuthServiceScope"),
        ["buildAuthController", "buildIndexedAuthController"],
      );
      assert.match(
        sources.typesSource,
        /^ {2}indexedAuthController: IndexedAuthController;$/m,
      );
    });
  });

  describe("When there is no generated output at all", () => {
    it("should generate in one run with an opener consumer already present", () => {
      const { openers, demandSupply, sources } = generate(coldDir, [
        "contracts.ts",
        "root-and-consumer.ts",
      ]);

      assert.deepStrictEqual(
        openers.map((o) => o.openerKey),
        ["openAuthServiceScope"],
      );
      assert.deepStrictEqual(
        demanderNames(demandSupply, "openAuthServiceScope"),
        ["buildAuthController"],
      );
      assert.match(
        sources.typesSource,
        /^ {2}openAuthServiceScope: OpenAuthServiceScope;$/m,
      );
    });
  });

  describe("When an opener-shaped name is in no variant's plan", () => {
    it("should still reject it as the stale generated output it is", () => {
      assert.throws(
        () => generate(warmDir, ["contracts.ts", "stale-alias-consumer.ts"]),
        (error: unknown) => {
          const message = messageOf(error);
          assert.match(message, /Re-run generation/);
          assert.match(message, /OpenRetiredServiceScope/);
          // The tolerance did not swallow it into a resolved demand, and it did not degrade into
          // the checker's "unresolvable deps type" either — the diagnostic names the real mistake.
          assert.doesNotMatch(message, /unresolvable deps type/);
          return true;
        },
      );
    });

    it("should keep rejecting it while a DIFFERENT root's opener resolves in the same run", () => {
      // Both names are imported from a generated file that exports neither. Only the plan separates
      // them, which is the whole claim: `OpenAuthServiceScope` resolves, `OpenRetiredServiceScope`
      // does not, in one pass over one file set.
      assert.throws(
        () =>
          generate(warmDir, [
            "contracts.ts",
            "root-and-alias-consumer.ts",
            "stale-alias-consumer.ts",
          ]),
        (error: unknown) => {
          const message = messageOf(error);
          assert.match(message, /Re-run generation/);
          assert.match(message, /OpenRetiredServiceScope/);
          assert.doesNotMatch(message, /OpenAuthServiceScope/);
          return true;
        },
      );
    });

    it("should reject it through a composed deps type too", () => {
      // The property-declaration route is what makes a composed deps type's opener reference
      // visible at all. Visible means JUDGED: in the plan it resolves, out of it it is rejected.
      assert.throws(
        () =>
          generate(warmDir, [
            "contracts.ts",
            "stale-alias-composed-consumer.ts",
          ]),
        (error: unknown) => {
          const message = messageOf(error);
          assert.match(message, /Re-run generation/);
          assert.match(message, /OpenRetiredServiceScope/);
          assert.doesNotMatch(message, /unresolvable deps type/);
          return true;
        },
      );
    });
  });
});
