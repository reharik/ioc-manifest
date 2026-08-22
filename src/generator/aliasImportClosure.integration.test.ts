/**
 * Emission invariant: **every type name the emitter prints must be import-closed** — either
 * emitted by reference to a specifier the generated file imports, or not printed at all.
 *
 * The fixture mirrors a consumer-migration failure. A local exported alias
 * (`type ScopedContainerPlugin = Plugin<InitialGraphQLContext | GraphQLContext>`) whose target is a
 * generic instantiation from a third-party package was EXPANDED into that package's structural
 * intersection. The expansion named types the package root does not export (TS2305) and types
 * local to the consumer's own file with no import at all (TS2304), so the generated
 * `ioc-registry.types.ts` did not compile — and nothing in generation noticed.
 *
 * Two things are pinned here. Named contracts are emitted BY REFERENCE, aliases of generic
 * instantiations included. And the one path that still legitimately prints structure — a type
 * nothing names — has its printed text verified against what the file will import, hard-erroring
 * at generation rather than shipping text a consumer's `tsc` will reject.
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { analyzeDemandSupply } from "./analyzeDemandSupply/index.js";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import { buildRegistrationPlan } from "./resolveRegistrationPlan.js";
import { contractSlotsForPlans } from "./contractSlotKeys.js";
import { buildManifestArtifactSources } from "./writeManifest.js";
import { EmitImportClosureError } from "./emit/index.js";
import {
  assertGeneratedSourceCompiles,
  compileGeneratedSource,
} from "../test-support/compileGeneratedSource.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "test-fixtures", "alias-import-closure");
const appDir = path.join(fixtureDir, "app");
const generatedDir = path.join(appDir, "generated");
const typesPath = path.join(generatedDir, "ioc-registry.types.ts");
const scanDirs = [{ absPath: appDir }];

const fixture = (name: string): string => path.join(appDir, name);

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
};

/**
 * The real generation pipeline over a fixture set, in the order `generateManifest` runs it, up to
 * and including artifact serialization. Nothing is written to disk: the assertion that matters is
 * whether the SOURCE it produces compiles, which {@link assertGeneratedSourceCompiles} answers by
 * overlaying the text at `typesPath` in a fresh program.
 */
const generate = (files: string[]) => {
  const program = ts.createProgram({ rootNames: files, options: compilerOptions });
  const { contractMap, acceptedFactories } = discoverFactories(
    files,
    program,
    fixtureDir,
    "build",
    { projectRoot: fixtureDir, scanDirs, generatedDir },
  );
  const plans = buildRegistrationPlan(contractMap, undefined, {
    projectRoot: fixtureDir,
    scanDirs,
  });
  const demandSupply = analyzeDemandSupply(acceptedFactories, {
    program,
    projectRoot: fixtureDir,
    scanDirs,
    generatedDir,
    contractSlots: contractSlotsForPlans(plans),
  });
  const sources = buildManifestArtifactSources(
    acceptedFactories,
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
        projectRoot: fixtureDir,
      },
    },
  );
  return { demandSupply, sources };
};

describe("emission import closure", () => {
  describe("When a contract is an exported alias of a third-party generic instantiation", () => {
    it("should emit the cradle entry by reference to the alias, not its structural expansion", () => {
      const { demandSupply } = generate([fixture("scopedContainerPlugin.ts")]);

      const entry = demandSupply.entries.find(
        (e) => e.key === "useScopedContainer",
      );
      assert.ok(entry, "the factory claims a cradle key");
      assert.strictEqual(entry.typeRef.typeName, "ScopedContainerPlugin");
      assert.deepStrictEqual(
        entry.typeRef.imports.map((i) => i.typeName),
        ["ScopedContainerPlugin"],
      );
      assert.match(
        entry.typeRef.imports[0]!.relImport,
        /scopedContainerPlugin\.js$/,
      );
    });

    it("should not leak the vendor package's structural expansion into the generated source", () => {
      const { sources } = generate([fixture("scopedContainerPlugin.ts")]);

      // The names the field failure imported from the package root, which exports none of them.
      for (const leaked of [
        "ServerAdapterPlugin",
        "OnExecuteHook",
        "OnParamsHook",
        "OnPluginInitHook",
      ]) {
        assert.ok(
          !sources.typesSource.includes(leaked),
          `${leaked} must not appear in the generated source`,
        );
      }
      // ...and the consumer-local names that appeared bare, with no import.
      assert.ok(!sources.typesSource.includes("InitialGraphQLContext"));
      assert.ok(!sources.typesSource.includes("GraphQLContext"));
    });

    it("should produce a generated source that compiles standalone", () => {
      const { sources } = generate([fixture("scopedContainerPlugin.ts")]);
      assertGeneratedSourceCompiles(sources.typesSource, typesPath);
    });
  });

  describe("When an exported branded alias is demanded", () => {
    it("should emit the alias by reference rather than inlining its module-local brand", () => {
      const { demandSupply, sources } = generate([fixture("brandedId.ts")]);

      const entry = demandSupply.entries.find((e) => e.key === "userId");
      assert.ok(entry);
      // The expansion is `string & { readonly [brand]: "UserId"; }`, where `brand` is a
      // module-local `const` no import can bind.
      assert.strictEqual(entry.typeRef.typeName, "UserId");
      assert.ok(!sources.typesSource.includes("[brand]"));
      assertGeneratedSourceCompiles(sources.typesSource, typesPath);
    });
  });

  describe("When a printed structural type references a name nothing imports", () => {
    it("should hard-error naming the position and the unresolvable name, and write nothing", () => {
      assert.ok(!fs.existsSync(generatedDir), "precondition: nothing generated");

      assert.throws(
        () => generate([fixture("unimportedName.ts")]),
        (err: unknown) => {
          assert.ok(err instanceof EmitImportClosureError, String(err));
          assert.match(err.message, /"AppContext"/);
          assert.match(err.message, /TS2304/);
          // Position: which contract, and where in the generated file it was headed.
          assert.match(err.message, /buildUnimportedName/);
          assert.match(err.message, /property "handlers"/);
          // The offending text is quoted so the shape is identifiable without re-deriving it.
          assert.match(err.message, /Hook<AppContext>/);
          return true;
        },
      );

      assert.ok(
        !fs.existsSync(generatedDir),
        "a refused emission writes nothing",
      );
    });
  });

  describe("When an emitted import names something its module does not export", () => {
    it("should hard-error naming the specifier and the name, and write nothing", () => {
      assert.throws(
        () => generate([fixture("unexportedLocal.ts")]),
        (err: unknown) => {
          assert.ok(err instanceof EmitImportClosureError, String(err));
          assert.match(err.message, /"LocalOnlyShape"/);
          assert.match(err.message, /unexportedLocal\.js/);
          assert.match(err.message, /TS2305/);
          assert.match(err.message, /buildUnexportedLocal/);
          return true;
        },
      );

      assert.ok(!fs.existsSync(generatedDir));
    });
  });

  describe("When the fixture is checked against the failure it reproduces", () => {
    it("should confirm the pre-fix expansion really does not compile at the generated path", () => {
      // Verbatim output of the emitter BEFORE by-reference alias emission: the alias collapsed into
      // the vendor package's structural intersection, imports gathered by a separate traversal.
      // Pinned so the fixture cannot quietly stop reproducing the field failure — if this text ever
      // compiles, the fixture no longer models the shape that broke a consumer's build.
      const preFix =
        'import type { OnExecuteHook, OnParamsHook, OnPluginInitHook, ServerAdapterPlugin } from "@vendor/yoga";\n' +
        "export interface IocGeneratedCradle {\n" +
        "  useScopedContainer: ServerAdapterPlugin & { onExecute?: OnExecuteHook<InitialGraphQLContext | GraphQLContext> | undefined; onParams?: OnParamsHook<InitialGraphQLContext | GraphQLContext> | undefined; onPluginInit?: OnPluginInitHook<InitialGraphQLContext | GraphQLContext> | undefined; };\n" +
        "}\n";

      const { diagnostics } = compileGeneratedSource(preFix, typesPath);
      const codes = new Set(diagnostics.map((d) => d.code));
      // Names the package root does not export, and consumer-local names with no import at all.
      assert.ok(codes.has(2305), `expected TS2305, got ${[...codes].join(", ")}`);
      assert.ok(codes.has(2304), `expected TS2304, got ${[...codes].join(", ")}`);
    });
  });

  describe("When the emitted source would not compile", () => {
    it("should be caught by the compile assertion the other cases rely on", () => {
      // Guards the guard: a compile assertion that cannot fail proves nothing about the ones above.
      assert.throws(
        () =>
          assertGeneratedSourceCompiles(
            'import type { Missing } from "./nowhere.js";\n' +
              "export interface IocGeneratedCradle {\n  x: Missing;\n}\n",
            typesPath,
          ),
        /emitted source does not compile/,
      );
    });
  });
});
