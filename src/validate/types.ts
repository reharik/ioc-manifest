/**
 * @fileoverview Issue model for `ioc validate`. The `--json` output uses this shape as the public CLI API.
 */

/** Public CLI categories — keep stable when adding checks. */
export type ValidationIssueCategory =
  | "externals"
  | "schema-version"
  | "same-key-conflict"
  | "group-kind"
  | "group-base-type"
  | "group-key-conflict"
  | "default-ambiguity"
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

export type ValidateContext = {
  readonly projectRoot: string;
  readonly configPath: string;
  readonly slices: readonly ParsedManifestSlice[];
  readonly composedPackageNames: readonly string[];
  readonly overrides: import("../runtime/composedOverrides.js").ComposedRegistrationOverrides | undefined;
  readonly localContractNames: ReadonlySet<string>;
  readonly composedContractNames: ReadonlySet<string>;
  readonly declaredGroupNames: ReadonlySet<string>;
};
