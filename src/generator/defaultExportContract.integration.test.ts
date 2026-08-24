/**
 * Contract identity requires a NAME, and a default export does not have one.
 *
 * The fixture reproduces a field shape: `import Router from "@koa/router"` used as a factory's
 * return annotation. Before this, the contract resolved to the literal name `default` and every
 * layer carried it — a discovery row reading `✔ buildAppRouter → default`, an emitted
 * `import type { default } from "@vendor/router"`, and a cradle property `default: default`. None
 * of that compiles, and the emission invariant ("nothing broken is written") did not fire.
 *
 * Two layers are pinned here, and they are pinned INDEPENDENTLY on purpose.
 *
 * **Layer 1** refuses at the contract site, where the mistake is and where the fix is: the site must
 * name a name-importable declaration, and the error prescribes the local wrapper.
 *
 * **Layer 2** is the guard, and it is a guard precisely because it does not depend on layer 1. The
 * verifier is fed the exact broken emission and must refuse it — because the reason it accepted that
 * text was structural, not incidental: it re-parsed the printed TYPE text, where `default` is a
 * name the parser reads leniently, and never the IMPORT LINE, which is the one position where a
 * reserved word is a syntax error. Probing the type text alone asked the only question the breach
 * could pass.
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { analyzeDemandSupply } from "./analyzeDemandSupply/index.js";
import { contractSlotsForPlans } from "./contractSlotKeys.js";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import {
  EmitImportClosureError,
  verifyImportBindingName,
  verifyImportClosure,
} from "./emit/index.js";
import { buildRegistrationPlan } from "./resolveRegistrationPlan.js";
import { buildManifestArtifactSources } from "./writeManifest.js";
import {
  assertGeneratedSourceCompiles,
  compileGeneratedSource,
} from "../test-support/compileGeneratedSource.js";
import { IocDiscoveryStatus } from "./discoverFactories/discoveryOutcomeTypes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "test-fixtures", "default-export-contract");
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
  esModuleInterop: true,
};

const makeProgram = (files: string[]): ts.Program =>
  ts.createProgram({ rootNames: files, options: compilerOptions });

/** The real generation pipeline over a fixture set, in the order `generateManifest` runs it. */
const generate = (files: string[]) => {
  const program = makeProgram(files);
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

/** Discovery in the tolerant mode `ioc inspect --discovery` uses, so skipped rows are readable. */
const discoveryRowsFor = (files: string[]) => {
  const program = makeProgram(files);
  const { discoveryFiles } = discoverFactories(
    files,
    program,
    fixtureDir,
    "build",
    { projectRoot: fixtureDir, scanDirs, generatedDir },
    undefined,
    { collectFileRecords: true, tolerateInvalidAnnotations: true },
  );
  return discoveryFiles.flatMap((f) => f.outcomes);
};

const DOCS_ANCHOR =
  "https://reharik.github.io/ioc-manifest/guide/adopting#foreign-types-need-local-names";

describe("default-export contracts", () => {
  describe("When a factory annotates a type its package exposes only as the default export", () => {
    it("should refuse at the contract site, naming the factory, the site and the foreign module", () => {
      assert.ok(!fs.existsSync(generatedDir), "precondition: nothing generated");

      assert.throws(
        () => generate([fixture("appRouter.ts")]),
        (err: unknown) => {
          const message = (err as Error).message;
          assert.match(message, /\[contract_annotation_default_export\]/);
          // The three things the offender has to name.
          assert.match(message, /"buildAppRouter"/);
          assert.match(message, /appRouter\.ts:\d+/);
          assert.match(message, /"@vendor\/router"/);
          // The prescribed edit, written out against the offender's own names.
          assert.match(
            message,
            /export interface RouterContract extends Router \{\}/,
          );
          assert.ok(message.includes(DOCS_ANCHOR), message);
          return true;
        },
      );

      assert.ok(
        !fs.existsSync(generatedDir),
        "a refused generation writes nothing",
      );
    });

    it("should never report the contract as the bare name `default`", () => {
      const rows = discoveryRowsFor([fixture("appRouter.ts")]);
      const row = rows.find(
        (r) => r.scope === "export" && r.exportName === "buildAppRouter",
      );
      assert.ok(row !== undefined && row.scope === "export");
      assert.strictEqual(row.status, IocDiscoveryStatus.SKIPPED);
      assert.strictEqual(
        row.status === IocDiscoveryStatus.SKIPPED ? row.skipReason : undefined,
        "contract_annotation_default_export",
      );
      // The WRITTEN name, which points back at the reader's own file — never `default`, which
      // points at nothing and is what the row used to say.
      assert.strictEqual(
        row.status === IocDiscoveryStatus.SKIPPED ? row.contractName : undefined,
        "Router",
      );
      for (const other of rows) {
        assert.notStrictEqual(
          other.scope === "export" ? other.contractName : undefined,
          "default",
        );
      }
    });
  });

  describe("When the module publishes its type through `export =`", () => {
    it("should refuse it too, saying so rather than calling it a default export", () => {
      assert.throws(
        () => generate([fixture("legacyRouter.ts")]),
        (err: unknown) => {
          const message = (err as Error).message;
          assert.match(message, /\[contract_annotation_default_export\]/);
          assert.match(message, /"buildLegacyRouter"/);
          assert.match(message, /"@vendor\/legacy-router"/);
          assert.match(message, /publishes through `export =`/);
          assert.match(
            message,
            /export interface LegacyRouterContract extends LegacyRouter \{\}/,
          );
          return true;
        },
      );
      assert.ok(!fs.existsSync(generatedDir));
    });
  });

  describe("When a class unit's `implements` entry names a default export", () => {
    it("should refuse at that contract site as well", () => {
      assert.throws(
        () => generate([fixture("routerClass.ts")]),
        (err: unknown) => {
          const message = (err as Error).message;
          assert.match(message, /\[contract_annotation_default_export\]/);
          // Reported as a class, not a factory — the two unit kinds share the contract site rule.
          assert.match(message, /class:\s+"AppRouterImpl"/);
          assert.match(message, /"@vendor\/router"/);
          return true;
        },
      );
      assert.ok(!fs.existsSync(generatedDir));
    });
  });

  describe("When the declaration is this project's own default export", () => {
    it("should prescribe a named export rather than a wrapper", () => {
      assert.throws(
        () => generate([fixture("localDefaultRouter.ts")]),
        (err: unknown) => {
          const message = (err as Error).message;
          assert.match(message, /\[contract_annotation_default_export\]/);
          assert.match(message, /"buildLocalRouter"/);
          assert.match(message, /Export the declaration under its name/);
          assert.match(message, /export class Router/);
          // The wrapper is the FOREIGN fix; prescribing it here would be the merely defensible edit.
          assert.ok(
            !message.includes("Wrap it locally"),
            "a local declaration is renamed, not wrapped",
          );
          return true;
        },
      );
    });
  });

  describe("When the foreign type is given a local name", () => {
    it("should generate, emit the wrapper by reference, and compile", () => {
      const { demandSupply, sources } = generate([fixture("wrappedRouter.ts")]);

      const entry = demandSupply.entries.find((e) => e.key === "appRouter");
      assert.ok(entry, "the factory claims a cradle key");
      assert.strictEqual(entry.typeRef.typeName, "AppRouter");

      assert.match(
        sources.typesSource,
        /import type \{ AppRouter \} from "\.\.\/wrappedRouter\.js";/,
      );
      assert.ok(
        !sources.typesSource.includes("default"),
        "no trace of the export name survives into the generated file",
      );
      assertGeneratedSourceCompiles(sources.typesSource, typesPath, {
        esModuleInterop: true,
      });
    });
  });

  describe("When a foreign default export is used in a DEPS position instead", () => {
    it("should still generate: a deps property is a demand, not a contract site", () => {
      // The audit's boundary. Nothing is identified by a deps property, so a foreign type needs no
      // name there and emission already reaches it as `import type Router from "…"`. A refusal that
      // spread to this position would refuse the shape it exists to permit.
      const { sources } = generate([fixture("depsRouter.ts")]);

      assert.match(
        sources.typesSource,
        /import type Router from "@vendor\/router";/,
      );
      assert.match(sources.typesSource, /router: Router;/);
      assertGeneratedSourceCompiles(sources.typesSource, typesPath, {
        esModuleInterop: true,
      });
    });
  });

  describe("When the import-closure verifier is fed the broken emission directly", () => {
    /**
     * Layer 2 standing alone. Nothing here goes through discovery, so this passes or fails purely
     * on whether the verifier itself judges the text — which is what makes it a guard on any FUTURE
     * path that emits a non-name, not merely a second opinion about this one.
     */
    const brokenEmission = {
      typeName: "default",
      imports: [
        {
          typeName: "default",
          relImport: "@vendor/router",
          useDefaultImport: false,
        },
      ],
    } as const;

    it("should refuse the emission, quoting the import line that is not parseable", () => {
      const program = makeProgram([fixture("appRouter.ts")]);

      assert.throws(
        () =>
          verifyImportClosure(brokenEmission, { program, generatedDir }, "probe"),
        (err: unknown) => {
          assert.ok(err instanceof EmitImportClosureError, String(err));
          assert.match(err.message, /not well-formed TypeScript/);
          assert.match(err.message, /Identifier expected/);
          assert.match(
            err.message,
            /import type \{ default \} from "@vendor\/router";/,
          );
          return true;
        },
      );
    });

    it("should refuse the import spec on its own, for the paths that build one by hand", () => {
      // `writeManifest`'s plan-driven contract imports never pass through the emitter's seam. That
      // bypass is the third gap: the invariant could not fire on text it was never shown.
      assert.throws(
        () => verifyImportBindingName(brokenEmission.imports[0]),
        (err: unknown) => {
          assert.ok(err instanceof EmitImportClosureError, String(err));
          assert.match(err.message, /is not parseable/);
          return true;
        },
      );
    });

    it("should still accept the forms that are legitimately emitted", () => {
      // Guards the guard from the other side: a check that refused everything would pass the two
      // assertions above while breaking every real emission.
      verifyImportBindingName({
        typeName: "Router",
        relImport: "@vendor/router",
        useDefaultImport: true,
      });
      verifyImportBindingName({
        typeName: "AppRouter",
        relImport: "../wrappedRouter.js",
        useDefaultImport: false,
      });
    });
  });

  describe("When the fixture is checked against the failure it reproduces", () => {
    it("should confirm the pre-fix emission really does not compile at the generated path", () => {
      // Verbatim output of the generator BEFORE this fix, for the appRouter fixture. Pinned so the
      // fixture cannot quietly stop reproducing the shape that shipped: if this text ever compiles,
      // the two layers above are guarding nothing.
      const preFix =
        'import type Router from "@vendor/router";\n' +
        'import type { default } from "@vendor/router";\n\n' +
        "export interface IocGeneratedCradle {\n" +
        "  appRouter: Router;\n" +
        "  default: default;\n" +
        "}\n";

      const { diagnostics } = compileGeneratedSource(preFix, typesPath, {
        esModuleInterop: true,
      });
      const codes = new Set(diagnostics.map((d) => d.code));
      // TS1003 "Identifier expected." — a SYNTACTIC error, and only at the import clause. That it is
      // syntactic there and silent in the type position is the whole of the layer-2 diagnosis.
      assert.ok(codes.has(1003), `expected TS1003, got ${[...codes].join(", ")}`);
    });
  });
});
