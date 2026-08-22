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
 *   "summary": "Unsatisfied external: @pkg demands \"logger\" (type: Logger)",
 *   "details": ["No manifest in composedManifests supplies this key."],
 *   "suggestedFix": "Register a Logger factory in this package, or compose another manifest that supplies it."
 * }
 * ```
 */
export type ValidationIssue = {
  readonly category: ValidationIssueCategory;
  readonly severity: ValidationIssueSeverity;
  readonly summary: string;
  readonly details: readonly string[];
  readonly suggestedFix?: string;
};

export type ParsedImplementationMeta = {
  readonly registrationKey: string;
  readonly default?: boolean;
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
