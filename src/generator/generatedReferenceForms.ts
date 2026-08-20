/**
 * @fileoverview THE enumeration of syntactic forms by which scanned source can reach a type
 * declared in the generated registry-types file (`ioc-registry.types.ts`).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * INVARIANT (closure by enumeration)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * Generation must never type-check its own prior output. Every reference from scanned source to
 * the generated file is therefore recognized SYNTACTICALLY — off the source AST and the module
 * specifier text alone — and is either
 *
 *   - RESOLVED against the in-memory manifest (a supported consumption pattern), or
 *   - REJECTED with a hard error naming the file, line, and offending form.
 *
 * There is no third outcome. A form that is neither resolved nor rejected FALLS THROUGH to
 * TypeScript's own type resolution, and that is a SILENT-WRONG-OUTPUT bug, not a crash:
 *
 *   - warm run  — the checker reads the PREVIOUS generated file and hands back stale types, which
 *                 are then baked into the new output. Generation succeeds and the result is wrong.
 *   - cold run  — the generated file does not exist yet, the reference resolves to `any`/error,
 *                 and generation either aborts with a misleading diagnostic or emits nonsense
 *                 (this is the 1.4.2 bug and the 2.3.2/2.3.3 chicken-and-egg).
 *
 * Because the failure is silent, exhaustiveness cannot be left implicit. This list IS the claim.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ADDING A FORM
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * TypeScript's grammar has a finite set of ways one module's types become visible in another. If
 * a new one appears (a new grammar feature, or one missed here), register it in this list FIRST:
 *
 *   1. add an entry below with its disposition and, when rejected, its guidance text;
 *   2. teach the detector — `generatedRegistryBindings.ts` for how the binding/use is recognized,
 *      `validateGeneratedReferencesAtCodegen.ts` for file-level rejection, or
 *      `analyzeDemandSupply/resolveIocGeneratedCradleIndexedAccess.ts` for resolution;
 *   3. add a fixture named `<id>.ts` under
 *      `test-fixtures/generated-reference-forms/` — `generatedReferenceForms.test.ts` iterates
 *      this list and fails when a form has no fixture, so the enumeration and the test surface
 *      cannot drift apart.
 *
 * The deps-position backstop in `analyzeDemandSupply` is the safety net for anything that slips
 * past steps 1–2: it re-checks syntactically, immediately before type resolution would happen,
 * that nothing reaching the generated file went unclaimed.
 */

/** What generation does with a reference form. */
export type GeneratedReferenceDisposition =
  /** Recognized syntactically and resolved against the in-memory manifest. */
  | "resolved"
  /**
   * Legal to write, never resolved, and safe: the generated name is only ever printed back, so
   * nothing is read out of prior output. This is the documented composition-root pattern
   * (`createContainer<IocGeneratedCradle>()`). Rejected by the deps-position backstop if it ever
   * reaches a factory deps type or return type, where printing back is not enough.
   */
  | "by-name"
  /** Hard error at generation time, with guidance toward a supported form. */
  | "rejected";

export type GeneratedReferenceForm = {
  /** Stable identifier; doubles as the fixture basename under `generated-reference-forms/`. */
  readonly id: string;
  /** The syntax being classified, as a user would write it. */
  readonly syntax: string;
  readonly disposition: GeneratedReferenceDisposition;
  /** Diagnostic headline: what the offending line does. Required for every rejected form. */
  readonly headline?: string;
  /** Why the form cannot be supported. A full sentence; required for every rejected form. */
  readonly reason?: string;
  /** What to write instead. Required for every rejected form. */
  readonly guidance?: string;
};

/**
 * Every form, classified. Ordered by category: module-linkage forms first (how a binding to the
 * generated module enters scope), then use forms (what may be done with such a binding), then the
 * indirections that reach a use form through an intermediate type alias.
 */
export const GENERATED_REFERENCE_FORMS: readonly GeneratedReferenceForm[] = [
  // ── Module linkage: how a name from the generated module enters a scanned file's scope ──────
  {
    id: "namedTypeImport",
    syntax: 'import type { Channels } from "./generated/ioc-registry.types.js"',
    disposition: "resolved",
  },
  {
    id: "aliasedNamedImport",
    syntax:
      'import type { IocGeneratedCradle as Cradle } from "./generated/ioc-registry.types.js"',
    disposition: "resolved",
  },
  {
    id: "inlineTypeImport",
    syntax: 'import { type Channels } from "./generated/ioc-registry.types.js"',
    disposition: "resolved",
  },
  {
    id: "namespaceImport",
    syntax:
      'import type * as Ioc from "./generated/ioc-registry.types.js"  →  Ioc.Channels',
    disposition: "resolved",
  },
  {
    id: "defaultImport",
    syntax: 'import type Ioc from "./generated/ioc-registry.types.js"',
    disposition: "rejected",
    headline:
      "default-imports the generated registry file",
    reason:
      "The generated registry file has no default export, so the binding can only resolve by " +
      "type-checking prior generated output",
    guidance:
      'Use a named type import instead (`import type { IocGeneratedCradle } from "…/ioc-registry.types.js"`).',
  },
  {
    id: "importEqualsRequire",
    syntax:
      'import Ioc = require("./generated/ioc-registry.types.js")  →  Ioc.Channels',
    disposition: "rejected",
    headline:
      "imports the generated registry file with `import … = require(…)`",
    reason:
      "A CommonJS import binding is resolved by the module loader rather than syntactically, so " +
      "every use of it forces type resolution through prior generated output",
    guidance:
      'Use a named or namespace type import instead (`import type { … } from "…/ioc-registry.types.js"`).',
  },
  {
    id: "importEqualsEntityAlias",
    syntax: "import Cradle = Ioc.IocGeneratedCradle",
    disposition: "rejected",
    headline:
      "aliases a generated registry name with `import … =`",
    reason:
      "An import-equals alias renames the binding outside the import clause, where the syntactic " +
      "interception cannot follow it",
    guidance:
      'Import the name directly under an alias instead (`import type { IocGeneratedCradle as Cradle } from "…/ioc-registry.types.js"`).',
  },
  {
    id: "exportEqualsGeneratedBinding",
    syntax: "export = Ioc",
    disposition: "rejected",
    headline:
      "re-publishes the generated registry file with `export =`",
    reason:
      "An export-assignment republishes the whole generated module under a new name, and " +
      "consumers of that name cannot be intercepted syntactically",
    guidance:
      "Import directly from the generated registry file instead of republishing it.",
  },
  {
    id: "reexportNamed",
    syntax:
      'export { IocGeneratedCradle } from "./generated/ioc-registry.types.js"',
    disposition: "rejected",
    headline:
      "re-exports from the generated registry file",
    reason:
      "Re-exported generated names cannot be intercepted syntactically, so consumers of the " +
      "re-export would force type resolution through prior generated output",
    guidance:
      "Import directly from the generated registry file instead of re-exporting it.",
  },
  {
    id: "reexportTypeNamed",
    syntax: 'export type { Channels } from "./generated/ioc-registry.types.js"',
    disposition: "rejected",
    headline:
      "re-exports from the generated registry file",
    reason:
      "Re-exported generated names cannot be intercepted syntactically, so consumers of the " +
      "re-export would force type resolution through prior generated output",
    guidance:
      "Import directly from the generated registry file instead of re-exporting it.",
  },
  {
    id: "reexportStar",
    syntax: 'export * from "./generated/ioc-registry.types.js"',
    disposition: "rejected",
    headline:
      "re-exports from the generated registry file",
    reason:
      "Re-exported generated names cannot be intercepted syntactically, so consumers of the " +
      "re-export would force type resolution through prior generated output",
    guidance:
      "Import directly from the generated registry file instead of re-exporting it.",
  },
  {
    id: "reexportStarAsNamespace",
    syntax: 'export * as ioc from "./generated/ioc-registry.types.js"',
    disposition: "rejected",
    headline:
      "re-exports from the generated registry file",
    reason:
      "Re-exported generated names cannot be intercepted syntactically, so consumers of the " +
      "re-export would force type resolution through prior generated output",
    guidance:
      "Import directly from the generated registry file instead of re-exporting it.",
  },
  {
    id: "importTypeNode",
    syntax: 'import("./generated/ioc-registry.types.js").IocGeneratedCradle',
    disposition: "rejected",
    headline:
      "references the generated registry file with an import() type",
    reason:
      "`typeof import(…)` / `import(…).X` references cannot be intercepted syntactically, so they " +
      "force type resolution through prior generated output",
    guidance:
      'Use a regular type import from the generated registry file instead (`import type { … } from "…/ioc-registry.types.js"`).',
  },
  {
    id: "typeofImportType",
    syntax: 'typeof import("./generated/ioc-registry.types.js")',
    disposition: "rejected",
    headline:
      "references the generated registry file with an import() type",
    reason:
      "`typeof import(…)` / `import(…).X` references cannot be intercepted syntactically, so they " +
      "force type resolution through prior generated output",
    guidance:
      'Use a regular type import from the generated registry file instead (`import type { … } from "…/ioc-registry.types.js"`).',
  },
  {
    id: "tripleSlashReference",
    syntax: '/// <reference path="./generated/ioc-registry.types.ts" />',
    disposition: "rejected",
    headline:
      "references the generated registry file with a reference directive",
    reason:
      "A reference directive pulls the generated file into the program before generation has " +
      "written it, which is exactly the cold-start deadlock the syntactic interception exists to " +
      "avoid, and it grants no name that a type import does not",
    guidance:
      'Delete the directive and use a regular type import instead (`import type { … } from "…/ioc-registry.types.js"`).',
  },

  // ── Use forms: what may be done with a binding to the generated module ──────────────────────
  {
    id: "cradleIndexedAccess",
    syntax: 'Cradle["albumRepository"]',
    disposition: "resolved",
  },
  {
    id: "groupAliasReference",
    syntax: "Channels",
    disposition: "resolved",
  },
  {
    id: "openerAliasReference",
    syntax: "OpenAuthRouterScope  →  deps: { openAuthRouterScope: OpenAuthRouterScope }",
    disposition: "resolved",
  },
  {
    id: "staleOpenerAliasReference",
    syntax: "OpenRetiredRouterScope  (no such variant in this generation)",
    disposition: "rejected",
    headline:
      "references a scope-root opener type this generation does not emit",
    reason:
      "The name is shaped like an emitted opener alias but matches no scope-root variant discovered " +
      "on this run, so it can only be a name a PREVIOUS run wrote, and resolving it would read that " +
      "prior generated output",
    guidance:
      "Re-run generation and use the opener alias it emits, or fix the `ScopeRoot` variant whose opener you meant to name.",
  },
  {
    id: "bareTypeReference",
    syntax: "createContainer<IocGeneratedCradle>()",
    disposition: "by-name",
  },
  {
    id: "typeofGeneratedBinding",
    syntax: "typeof Ioc",
    disposition: "rejected",
    headline:
      "applies `typeof` to a generated registry binding",
    reason:
      "`typeof` on a generated binding asks for the module's or value's inferred shape, which only " +
      "prior generated output can supply",
    guidance:
      'Reference the generated type by name instead (`IocGeneratedCradle`), or index a single key (`IocGeneratedCradle["albumRepository"]`).',
  },
  {
    id: "keyofGeneratedBinding",
    syntax: "keyof IocGeneratedCradle",
    disposition: "rejected",
    headline:
      "applies `keyof` to a generated registry type",
    reason:
      "`keyof` bakes a snapshot of the PREVIOUS cradle's keys into the new output, so the key set " +
      "silently lags a generation behind",
    guidance:
      'Index the keys you need explicitly (`IocGeneratedCradle["albumRepository"]`), or declare the union yourself.',
  },
  {
    id: "chainedIndexedAccess",
    syntax: 'Cradle["albumRepository"]["findById"]',
    disposition: "rejected",
    headline:
      "chains indexed access on the generated cradle",
    reason:
      "Reading a member OUT of a cradle entry requires the entry's resolved type, which only prior " +
      "generated output can supply",
    guidance:
      'Index a single key (`Cradle["albumRepository"]`) and reach into the contract type in your own code, or import the contract type directly.',
  },
  {
    id: "nonLiteralIndexedAccess",
    syntax: 'Cradle[Key] / Cradle["a" | "b"]',
    disposition: "rejected",
    headline:
      "indexes the generated cradle with a non-literal key",
    reason:
      "The demanded key must be readable off the source text, and a computed or union index is " +
      "only knowable by type-checking prior generated output",
    guidance:
      'Index with a single string literal (`Cradle["albumRepository"]`), one property per demanded key.',
  },
  {
    id: "genericObjectTypeIndexedAccess",
    syntax: 'Cradle<string>["albumRepository"]',
    disposition: "rejected",
    headline:
      "indexes a type-argument-bearing reference to the generated cradle",
    reason:
      "An indexed access through a type-argument-bearing reference has to instantiate the generic " +
      "before the key can be read, and instantiation is type resolution",
    guidance:
      'Index the imported generated type directly (`IocGeneratedCradle["albumRepository"]`).',
  },
  {
    id: "unsupportedIndexedAccessTarget",
    syntax: 'Channels["length"] / IocExternals["config"]',
    disposition: "rejected",
    headline:
      "indexes a generated registry type other than `IocGeneratedCradle`",
    reason:
      "Only `IocGeneratedCradle` carries the registration keys that generation can resolve " +
      "syntactically; indexing any other generated type reads prior generated output",
    guidance:
      'Reference the group alias directly (`channels: Channels`) or index the cradle (`IocGeneratedCradle["channels"]`).',
  },
  {
    id: "heritageClauseReference",
    syntax: "interface Deps extends IocGeneratedCradle {}",
    disposition: "rejected",
    headline:
      "extends a generated registry type",
    reason:
      "Extending or implementing a generated type absorbs every member of the PREVIOUS cradle " +
      "into the deps type, so the whole stale registry is re-demanded on the next run",
    guidance:
      'Declare the keys the factory actually needs (`type Deps = { albumRepository: IocGeneratedCradle["albumRepository"] }`).',
  },

  // ── Indirection: reaching a use form through an intermediate type alias ─────────────────────
  {
    id: "localTypeAliasIndirection",
    syntax: 'type Local = Cradle["albumRepository"]  →  { repo: Local }',
    disposition: "resolved",
  },
  {
    id: "crossFileTypeAliasIndirection",
    syntax: 'export type Local = Channels  (another file)  →  { channels: Local }',
    disposition: "resolved",
  },
  {
    id: "unclaimedReferenceInDepsPosition",
    syntax:
      'type Deps = { cradle: IocGeneratedCradle } / { chans: ReadonlyArray<Channels> }',
    disposition: "rejected",
    headline:
      "references the generated registry file from a factory deps type",
    reason:
      "A factory deps type or return type is read member-by-member to build the new cradle, so a " +
      "generated type reaching that position is resolved out of prior generated output rather than " +
      "printed back",
    guidance:
      'Demand the individual keys instead (`{ albumRepository: IocGeneratedCradle["albumRepository"] }`), or reference a group alias directly (`{ channels: Channels }`).',
  },
];

const FORM_BY_ID = new Map(GENERATED_REFERENCE_FORMS.map((f) => [f.id, f]));

/** Lookup that throws rather than returning `undefined` — every call site passes a literal id. */
export const generatedReferenceForm = (id: string): GeneratedReferenceForm => {
  const form = FORM_BY_ID.get(id);
  if (form === undefined) {
    throw new Error(
      `[ioc] Unknown generated-reference form ${JSON.stringify(id)}. Register it in GENERATED_REFERENCE_FORMS.`,
    );
  }
  return form;
};

export const isRejectedGeneratedReferenceForm = (id: string): boolean =>
  generatedReferenceForm(id).disposition === "rejected";

/**
 * The single diagnostic shape for every rejected form: where it is, what the line does, the
 * offending source text verbatim, why the form cannot be supported, and what to write instead.
 * Both the codegen validator and the deps-position backstop format through here, so the wording
 * of a rejection lives with the enumeration entry rather than at the detection site.
 */
export const formatRejectedGeneratedReference = (
  formId: string,
  location: string,
  sourceText: string,
): string => {
  const form = generatedReferenceForm(formId);
  if (
    form.headline === undefined ||
    form.reason === undefined ||
    form.guidance === undefined
  ) {
    throw new Error(
      `[ioc] Generated-reference form ${JSON.stringify(formId)} is rejected but carries no headline/reason/guidance.`,
    );
  }
  return (
    `[ioc] ${location} ${form.headline}: \`${sourceText}\`. ` +
    `${form.reason}. ${form.guidance}`
  );
};
