/**
 * One test per entry in {@link GENERATED_REFERENCE_FORMS}. The suite is DRIVEN BY the enumeration:
 * `EXPECTATIONS` is checked against it in both directions, so adding a form without a test — or
 * writing a test for a form nobody registered — fails here rather than silently leaving a hole.
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import type { IocGroupsManifest } from "../core/manifest.js";
import type { DiscoveredFactory } from "./types.js";
import { analyzeDemandSupply } from "./analyzeDemandSupply/index.js";
import {
  GENERATED_REFERENCE_FORMS,
  generatedReferenceForm,
} from "./generatedReferenceForms.js";
import { validateGeneratedReferencesAtCodegen } from "./validateGeneratedReferencesAtCodegen.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "test-fixtures/generated-reference-forms");
const coldDir = path.join(fixtureDir, "cold");
const contractsPath = path.join(fixtureDir, "contracts.ts");

const warmGeneratedDir = path.join(fixtureDir, "generated");
const coldGeneratedDir = path.join(coldDir, "generated");

/** The single group these fixtures declare; `Channels` is its emitted alias. */
const groupsManifest: IocGroupsManifest = {
  channels: {
    kind: "collection",
    baseType: "MediaStorage",
    baseTypeId: `${contractsPath}:MediaStorage`,
    members: [{ contractName: "MediaStorage", registrationKey: "storage" }],
  },
};

const factoriesFor = (modulePath: string): DiscoveredFactory[] => [
  {
    contractName: "MediaStorage",
    contractTypeRelImport: "../contracts.js",
    implementationName: "storage",
    exportName: "buildStorage",
    registrationKey: "storage",
    modulePath,
    relImport: `../${modulePath.replace(/\.ts$/, ".js")}`,
  },
  {
    contractName: "UploadService",
    contractTypeRelImport: "../contracts.js",
    implementationName: "uploadService",
    exportName: "buildUploadService",
    registrationKey: "uploadService",
    modulePath,
    relImport: `../${modulePath.replace(/\.ts$/, ".js")}`,
  },
];

const makeProgram = (rootNames: readonly string[]): ts.Program =>
  ts.createProgram({
    rootNames: [contractsPath, ...rootNames],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });

type FixtureRef = { readonly cold: boolean; readonly id: string };

const fixtureFiles = ({ cold, id }: FixtureRef): string[] => {
  const dir = cold ? coldDir : fixtureDir;
  const main = path.join(dir, `${id}.ts`);
  const aliases = path.join(dir, `${id}.aliases.ts`);
  return fs.existsSync(aliases) ? [main, aliases] : [main];
};

const runValidator = (ref: FixtureRef): void => {
  const files = fixtureFiles(ref);
  validateGeneratedReferencesAtCodegen(files, makeProgram(files), {
    projectRoot: ref.cold ? coldDir : fixtureDir,
    generatedDir: ref.cold ? coldGeneratedDir : warmGeneratedDir,
  });
};

const runAnalysis = (
  ref: FixtureRef,
): ReturnType<typeof analyzeDemandSupply> => {
  const files = fixtureFiles(ref);
  const modulePath = ref.cold ? `cold/${ref.id}.ts` : `${ref.id}.ts`;
  return analyzeDemandSupply(factoriesFor(modulePath), {
    program: makeProgram(files),
    projectRoot: fixtureDir,
    scanDirs: [{ absPath: fixtureDir }],
    generatedDir: ref.cold ? coldGeneratedDir : warmGeneratedDir,
    groupsManifest,
  });
};

const messageOfThrow = (fn: () => void): string => {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  assert.fail("expected a throw");
};

/** Escapes a guidance/reason string so it can be matched literally against an error message. */
const literal = (text: string): RegExp =>
  new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

/**
 * Asserts the diagnostic is the one this form owns: its headline, its guidance, and a `file:line`
 * naming the fixture. Together those are what makes a rejection actionable rather than a wall.
 */
const assertFormDiagnostic = (message: string, id: string): void => {
  const form = generatedReferenceForm(id);
  assert.match(message, literal(form.headline!), `headline for ${id}`);
  assert.match(message, literal(form.guidance!), `guidance for ${id}`);
  assert.match(message, /\.ts:\d+/, `file:line for ${id}`);
};

/** How each form is exercised. Checked for total coverage against the enumeration below. */
type Expectation =
  /** Validator rejects it, with this form's own headline and guidance. */
  | { readonly kind: "rejectedByValidator" }
  /** Validator passes; demand analysis rejects it through the deps-position backstop. */
  | { readonly kind: "rejectedByBackstop"; readonly cold?: boolean }
  /**
   * Validator passes and demand analysis resolves it. `cradleKeys` are the deps property names
   * expected to appear as cradle entries with the given contract type; `absentKeys` are property
   * names that must NOT appear (a group consumption short-circuits instead of demanding).
   */
  | {
      readonly kind: "resolved";
      readonly expectTypes?: Readonly<Record<string, string>>;
      readonly absentKeys?: readonly string[];
      readonly cold?: boolean;
    }
  /** Validator passes and the fixture declares no factory — nothing to resolve. */
  | { readonly kind: "acceptedByName" };

const EXPECTATIONS: Readonly<Record<string, Expectation>> = {
  // Module linkage — resolved
  namedTypeImport: { kind: "resolved", absentKeys: ["channels"] },
  aliasedNamedImport: {
    kind: "resolved",
    expectTypes: { storage: "MediaStorage" },
  },
  inlineTypeImport: { kind: "resolved", absentKeys: ["channels"] },
  namespaceImport: {
    kind: "resolved",
    expectTypes: { storage: "MediaStorage" },
    absentKeys: ["channels"],
    cold: true,
  },
  // Module linkage — rejected
  defaultImport: { kind: "rejectedByValidator" },
  importEqualsRequire: { kind: "rejectedByValidator" },
  importEqualsEntityAlias: { kind: "rejectedByValidator" },
  exportEqualsGeneratedBinding: { kind: "rejectedByValidator" },
  reexportNamed: { kind: "rejectedByValidator" },
  reexportTypeNamed: { kind: "rejectedByValidator" },
  reexportStar: { kind: "rejectedByValidator" },
  reexportStarAsNamespace: { kind: "rejectedByValidator" },
  importTypeNode: { kind: "rejectedByValidator" },
  typeofImportType: { kind: "rejectedByValidator" },
  tripleSlashReference: { kind: "rejectedByValidator" },
  // Use forms — resolved / by-name
  cradleIndexedAccess: {
    kind: "resolved",
    expectTypes: { storage: "MediaStorage" },
    cold: true,
  },
  groupAliasReference: { kind: "resolved", absentKeys: ["channels"] },
  bareTypeReference: { kind: "acceptedByName" },
  // Use forms — rejected
  typeofGeneratedBinding: { kind: "rejectedByValidator" },
  keyofGeneratedBinding: { kind: "rejectedByValidator" },
  chainedIndexedAccess: { kind: "rejectedByValidator" },
  nonLiteralIndexedAccess: { kind: "rejectedByValidator" },
  genericObjectTypeIndexedAccess: { kind: "rejectedByValidator" },
  unsupportedIndexedAccessTarget: { kind: "rejectedByValidator" },
  heritageClauseReference: { kind: "rejectedByValidator" },
  // Indirection
  localTypeAliasIndirection: {
    kind: "resolved",
    expectTypes: { storage: "MediaStorage" },
    cold: true,
  },
  crossFileTypeAliasIndirection: {
    kind: "resolved",
    expectTypes: { storage: "MediaStorage" },
    absentKeys: ["channels"],
    cold: true,
  },
  unclaimedReferenceInDepsPosition: {
    kind: "rejectedByBackstop",
    cold: true,
  },
};

describe("generated-registry reference forms (closure by enumeration)", () => {
  describe("the enumeration and this suite agree", () => {
    it("has an expectation for every enumerated form", () => {
      const missing = GENERATED_REFERENCE_FORMS.filter(
        (form) => EXPECTATIONS[form.id] === undefined,
      ).map((form) => form.id);
      assert.deepStrictEqual(
        missing,
        [],
        "register the new form in EXPECTATIONS and add a fixture",
      );
    });

    it("has no expectation for a form nobody enumerated", () => {
      const known = new Set(GENERATED_REFERENCE_FORMS.map((f) => f.id));
      const orphans = Object.keys(EXPECTATIONS).filter((id) => !known.has(id));
      assert.deepStrictEqual(orphans, []);
    });

    it("has a fixture file for every enumerated form", () => {
      const missing = GENERATED_REFERENCE_FORMS.filter(
        (form) => !fs.existsSync(path.join(fixtureDir, `${form.id}.ts`)),
      ).map((form) => form.id);
      assert.deepStrictEqual(missing, []);
    });

    it("gives every rejected form a headline, a reason and guidance", () => {
      const incomplete = GENERATED_REFERENCE_FORMS.filter(
        (form) =>
          form.disposition === "rejected" &&
          (form.headline === undefined ||
            form.reason === undefined ||
            form.guidance === undefined),
      ).map((form) => form.id);
      assert.deepStrictEqual(incomplete, []);
    });
  });

  for (const form of GENERATED_REFERENCE_FORMS) {
    const expectation = EXPECTATIONS[form.id];
    if (expectation === undefined) {
      continue;
    }

    describe(`${form.id} — ${form.syntax}`, () => {
      if (expectation.kind === "rejectedByValidator") {
        it("is rejected at codegen, naming the file, the form and the fix", () => {
          const message = messageOfThrow(() =>
            runValidator({ cold: false, id: form.id }),
          );
          assertFormDiagnostic(message, form.id);
          assert.match(message, new RegExp(`${form.id}\\.ts:\\d+`));
        });
        return;
      }

      if (expectation.kind === "rejectedByBackstop") {
        it("passes the file-level validator (naming a generated type is legal)", () => {
          runValidator({ cold: false, id: form.id });
        });

        it("is rejected by the deps-position backstop before type resolution", () => {
          const message = messageOfThrow(() =>
            runAnalysis({ cold: false, id: form.id }),
          );
          assertFormDiagnostic(message, form.id);
        });

        if (expectation.cold === true) {
          it("is rejected identically on a cold start", () => {
            const message = messageOfThrow(() =>
              runAnalysis({ cold: true, id: form.id }),
            );
            assertFormDiagnostic(message, form.id);
          });
        }
        return;
      }

      if (expectation.kind === "acceptedByName") {
        it("is not rejected — the name is only printed back", () => {
          runValidator({ cold: false, id: form.id });
        });
        return;
      }

      const assertResolved = (cold: boolean): void => {
        const result = runAnalysis({ cold, id: form.id });
        const byKey = new Map(result.entries.map((e) => [e.key, e.typeRef.typeName]));

        for (const [key, typeName] of Object.entries(
          expectation.expectTypes ?? {},
        )) {
          assert.strictEqual(
            byKey.get(key),
            typeName,
            `cradle entry for ${JSON.stringify(key)}`,
          );
        }
        for (const key of expectation.absentKeys ?? []) {
          assert.ok(
            !byKey.has(key),
            `group consumption must not demand ${JSON.stringify(key)}`,
          );
        }
        // The generated fixture types every key as StaleContract. Seeing it anywhere means the
        // reference was resolved out of prior output instead of claimed syntactically.
        for (const typeName of byKey.values()) {
          assert.doesNotMatch(
            typeName,
            /StaleContract/,
            "resolved through the previous generated file",
          );
        }
      };

      it("is accepted by the file-level validator", () => {
        runValidator({ cold: false, id: form.id });
      });

      it("resolves against the manifest, not the previous generated file", () => {
        assertResolved(false);
      });

      if (expectation.cold === true) {
        it("resolves identically with no generated file on disk (cold start)", () => {
          assert.strictEqual(fs.existsSync(coldGeneratedDir), false);
          assertResolved(true);
        });
      }
    });
  }
});
