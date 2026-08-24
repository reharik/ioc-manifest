/**
 * @fileoverview Issue model for the composition suite, run by BOTH `ioc generate` (app mode) and
 * `ioc validate`. `ioc validate --json` serializes this shape as the public CLI API, so the
 * categories and severities below are a compatibility surface — keep them stable when adding checks.
 */

/** Public CLI categories — keep stable when adding checks. */
export type ValidationIssueCategory =
  | "externals"
  | "registry-integrity"
  | "schema-version"
  | "same-key-conflict"
  | "group-kind"
  | "group-base-type"
  | "group-key-conflict"
  | "default-ambiguity"
  | "slot-occupancy"
  | "app-config"
  | "unused-config";

export type ValidationIssueSeverity = "error" | "warning";

/**
 * One validation finding. Serialized verbatim for `--json`.
 *
 * @example
 * ```json
 * {
 *   "category": "externals",
 *   "severity": "error",
 *   "summary": "Nothing supplies \"logger\", which @pkg expects the container to already have.",
 *   "details": ["key:       \"logger\"  demanded by @pkg", "demanded:  Logger"],
 *   "suggestedFix": "Register a Logger factory in this package, or compose another manifest that supplies it.",
 *   "docUrl": "https://reharik.github.io/ioc-manifest/monorepo/composition#externals"
 * }
 * ```
 */
export type ValidationIssue = {
  readonly category: ValidationIssueCategory;
  readonly severity: ValidationIssueSeverity;
  /** Plain-language statement of what happened. No type text, no paths — those are `details`. */
  readonly summary: string;
  /** The mechanism: keys, packages, types, paths. Dense on purpose. */
  readonly details: readonly string[];
  readonly suggestedFix?: string;
  /**
   * The page that articulates the rule this issue is about, resolved from {@link category} through
   * `diagnostics/errorDocs.ts`.
   *
   * Attached by `buildValidationReport`, so checks never write a URL and `--json` and the text
   * output cannot disagree. Absent when no page covers the category yet — a missing pointer is the
   * honest outcome, and better than a link to a page that does not exist.
   */
  readonly docUrl?: string;
  /**
   * The `sourceId`s of every slice this finding resolves through — the package that demanded the
   * key, the packages that supply it, the manifests that disagree. `"local"` for the running one.
   *
   * Machine tokens, not the prose labels the summary prints: this is read by the freshness pass to
   * decide which findings to caveat when a package's artifacts may predate its sources, and
   * matching on rendered prose would tie that decision to how a sentence happens to be worded.
   *
   * Optional because a finding can genuinely involve no manifest — an `app-config` complaint about
   * this package's own config is about the config, not about anyone's artifacts.
   */
  readonly packages?: readonly string[];
  /**
   * Set by the freshness pass when one of {@link packages} may predate its sources.
   *
   * Carried on the issue rather than computed at render time so the text output and `--json` cannot
   * disagree about which findings are suspect — the same reason `docUrl` is attached here.
   */
  readonly possiblyStale?: true;
  /** The prose caveat rendered under a {@link possiblyStale} finding. Set with it, never alone. */
  readonly stalenessNote?: string;
};

export type ParsedImplementationMeta = {
  readonly registrationKey: string;
  readonly default?: boolean;
  /**
   * The rest of the unit as its manifest states it.
   *
   * The projection above was, for a long time, the two fields the CONTRACT checks read — and that
   * was the right narrowing while the only readers were checks adjudicating election and key
   * conflicts. `ioc explain` reads the same slices to answer about ONE key across the composed
   * picture, and its answer is made of exactly these: where the unit is declared, how long it
   * lives, why, and what it demands. They are carried here rather than parsed a second time
   * somewhere else, because two parses of one manifest are two chances to disagree about it.
   */
  readonly exportName?: string;
  readonly modulePath?: string;
  readonly implementationName?: string;
  readonly lifetime?: import("../core/manifest.js").IocImplementationLifetime;
  readonly lifetimeSource?: import("../core/manifest.js").IocLifetimeProvenance;
  readonly dependencyKeys?: readonly string[];
  /**
   * The contract's configured `$contract.accessKey`, when the manifest carries one.
   *
   * Emitted onto whichever implementation held it and omitted when it equals the convention key, so
   * absence means "camel-cased contract name" rather than "no slot" — {@link resolveManifestAccessKey}
   * is the one place that reading is done.
   */
  readonly accessKey?: string;
};

export type ParsedGroupRoot = {
  readonly kind: "collection" | "object";
  readonly baseType: string;
  readonly baseTypeId: string;
  readonly members: unknown;
};

export type ParsedManifestSlice = {
  /** Display label: local packageName or composed npm name. */
  readonly packageLabel: string;
  /** `composedManifests` entry or `"local"`. */
  readonly sourceId: string;
  readonly manifestPath: string;
  readonly typesPath: string;
  readonly manifestSchemaVersion: unknown;
  /**
   * The manifest's `IOC_MANIFEST_FEATURES` declaration, or `undefined` when it declares none.
   *
   * Absence of an optional field never distinguishes "there is none" from "the generator that
   * wrote this predates it" — see {@link import("../core/manifest.js").IocManifestFeature}. A
   * reader that renders a degraded note for one and a real answer for the other has to consult
   * this, so the slice carries it beside the data it qualifies.
   */
  readonly declaredFeatures: readonly string[] | undefined;
  readonly contracts: Readonly<
    Record<string, Readonly<Record<string, ParsedImplementationMeta>>>
  >;
  readonly groupRoots: Readonly<Record<string, ParsedGroupRoot>>;
  readonly cradleKeys: ReadonlySet<string>;
  readonly cradleTypes: Readonly<
    Record<string, { readonly typeText: string }>
  >;
  readonly externals: Readonly<
    Record<string, { readonly typeText: string }>
  >;
};

export type CompositionContext = {
  readonly projectRoot: string;
  readonly configPath: string;
  readonly slices: readonly ParsedManifestSlice[];
  /**
   * The app's own source files, as its build sees them — the root set the shared program is built
   * over. Carried on the context so both verbs construct the SAME program: `ioc generate` passes
   * its discovery targets, and `ioc validate` resolves the identical set from the same config.
   */
  readonly sourceFiles: readonly string[];
  /**
   * Generated artifacts whose on-disk content is not the content to judge, keyed by the path they
   * will be written to. `ioc generate` supplies the sources it is about to emit — judging the
   * previous run's output would be judging the wrong file. `ioc validate` supplies none.
   */
  readonly pendingArtifacts: ReadonlyMap<string, string> | undefined;
  /** Parsed once by the loader and reused, so the program is not re-reading `tsconfig.json`. */
  readonly tsconfig: import("../generator/iocProgramContext.js").IocTsconfigContext | undefined;
  readonly composedPackageNames: readonly string[];
  readonly overrides: import("../runtime/composedOverrides.js").ComposedRegistrationOverrides | undefined;
  readonly localContractNames: ReadonlySet<string>;
  readonly composedContractNames: ReadonlySet<string>;
  readonly declaredGroupNames: ReadonlySet<string>;
};
