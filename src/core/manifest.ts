import type { ManifestSchemaVersion } from "../schemaVersion.js";

export type IocModuleNamespace = Record<string, unknown>;

/** Lifetime values stored in generated manifests (lowercase; maps to Awilix `Lifetime`). */
export type IocImplementationLifetime = "singleton" | "scoped" | "transient";

/**
 * Registration unit kind (schema v3). `factory` — an exported function whose return type
 * annotation is the contract site; `class` — an exported class whose `implements` clause is.
 *
 * Emitted only for `"class"`: absent means `"factory"`, matching how every other conventional
 * value in this metadata (`default`, `accessKey`, …) is omitted rather than restated.
 */
export type IocUnitKind = "class" | "factory";

/** Normalizes the optional manifest `kind` field to its effective value. */
export const iocUnitKindOf = (kind: IocUnitKind | undefined): IocUnitKind =>
  kind ?? "factory";

/**
 * WHY a registration's lifetime is what it is — the mechanism that decided it.
 *
 * Declared here rather than beside the registration planner because it is now a MANIFEST field
 * (see {@link ModuleFactoryManifestMetadata.lifetimeSource}), and a field a composing app reads out
 * of another package's artifacts has to have its vocabulary fixed by the schema. The planner's
 * `IocRegistrationLifetimeSource` is an alias of this, so there is one union and not two.
 *
 * `discovery-root` names a `discovery.scanDirs[].scope`; `default` means nothing declared one.
 */
export type IocLifetimeProvenance =
  | "factory-config"
  | "lifetime-marker"
  /**
   * The marker sits on the GROUP BASE, so the whole family ranks this lifetime (Ruling 2: lifetime
   * is a property of the group). Distinguished from `lifetime-marker` because the declaration is
   * somewhere the member does not control, which is exactly what a reader chasing an unexpected
   * lifetime needs to be told.
   */
  | "group-base-marker"
  | "discovery-root"
  | "default";

export type IocConfigOverrideField =
  | "name"
  | "lifetime"
  | "default"
  | "accessKey";

/**
 * Contract-first manifest: each contract (interface/type name) maps to one or more
 * module factories (inner keys are implementation names from discovery).
 */
export type ModuleFactoryManifestMetadata = {
  /**
   * Registration unit kind (schema v3). Omitted for factories — absent reads as `"factory"`
   * (see {@link iocUnitKindOf}); present as `"class"` when the export is a class, which the
   * runtime constructs with the cradle as its single argument (Awilix PROXY injection).
   */
  kind?: IocUnitKind;
  /** Exported factory or class identifier, e.g. `buildLocalMediaStorage` / `S3MediaStorage`. */
  exportName: string;
  /** IoC registration key (from resolver metadata or derived module name). */
  registrationKey: string;
  /** Path relative to `src/`, informational. */
  modulePath: string;
  /** Relative import path from the generated manifest directory to the source file. */
  relImport: string;
  /** Contract / interface or type alias name the factory returns. */
  contractName: string;
  /** Derived from export: strip `definedPrefix` prefix and lowercase first character (or resolver metadata). */
  implementationName: string;
  /** Awilix lifetime for this registration. */
  lifetime: IocImplementationLifetime;
  /**
   * WHICH MECHANISM decided {@link lifetime} — the provenance `ioc explain` renders as a chain.
   *
   * The blind spot this closes has been stated in `inspection/explain.ts` since that command
   * shipped: a manifest recorded the lifetime it resolved and nothing about where the decision was
   * written down, so manifest-mode explain could only say "provenance not recorded" and app-mode
   * explain could say nothing at all about a composed unit — which is precisely the unit whose
   * lifetime a reader cannot go and look up for themselves, because its sources are in another
   * package.
   *
   * Optional, and omitted for a plan that carried none — a plan built without a lifetime context.
   * It inherits the same ambiguity {@link dependencyKeys} has, so it is declared through
   * {@link IOC_MANIFEST_FEATURES} rather than guessed at from absence.
   *
   * `"default"` IS written out, unlike every other conventional value in this metadata. The
   * omit-when-conventional rule applies to a field whose absent value is the only thing it could
   * have been — `kind` is `"factory"` or it is not a factory. Provenance is not that: `"default"`
   * is one of five equally real answers to "what decided this", and if it were omitted, absence
   * would have to mean `"default"` here and "not recorded" in a manifest that predates the field,
   * which is two readings of one silence. A reader chasing an unexpected lifetime is best served
   * by being told, in as many words, that nothing declared one. Rendering is where `"default"` is
   * suppressed for being uninformative — see `inspection/formatReports.ts`, which prints
   * provenance only when it is not this.
   */
  lifetimeSource?: IocLifetimeProvenance;
  /** Index into the parallel `iocModuleImports` array. */
  moduleIndex: number;
  group?: string;
  /** True when this implementation is the resolved default for the contract (config + discovery). */
  default?: boolean;
  /** How the export was matched during discovery. */
  discoveredBy?: "naming" | "implements";
  /** Which `ioc.config` registration fields were applied for this implementation after merge. */
  configOverridesApplied?: readonly IocConfigOverrideField[];
  /**
   * Contract types inferred as dependencies from the factory's first parameter (object properties).
   */
  dependencyContractNames?: readonly string[];
  /**
   * CRADLE KEYS this unit demands — the destructured deps property names, verbatim.
   *
   * Distinct from {@link dependencyContractNames}, which names contract TYPES and is silent about
   * anything whose type is not a discovered contract: a `viewerId: string` dependency contributes a
   * key here and nothing there. Keys are the vocabulary every demand walk in the tool speaks, so
   * this is what a COMPOSING app needs to walk edges into this package — without it a composed unit
   * is a leaf, and a scope root whose subtree runs through this package cannot see what that subtree
   * demands (see `docs/design/scope-roots.md`, cross-package subtree demand).
   *
   * Omitted when empty, and omitted entirely for a unit whose deps parameter is not a top-level
   * object binding pattern — the same "prefer omission" rule {@link dependencyContractNames}
   * follows. Absence is therefore ambiguous on its own, in TWO directions, and only the
   * `"dependencyKeysComplete"` token of {@link IOC_MANIFEST_FEATURES_EXPORT_NAME} resolves both:
   * without it, absence means "demands nothing" OR "predates the field" OR "the deps parameter
   * could not be read". With it, absence means "demands nothing" and nothing else.
   */
  dependencyKeys?: readonly string[];
  /**
   * When set, Awilix default-slot / cradle key for this contract (singular). Omitted when equal to
   * the convention key (camel-cased contract name).
   */
  accessKey?: string;
};

export type IocContractManifest = Record<
  string,
  Record<string, ModuleFactoryManifestMetadata>
>;

/**
 * Optional data a generated manifest is known to carry IN FULL.
 *
 * The problem this solves is that every optional field in this metadata is omitted when empty, so
 * absence never distinguishes "there is none" from "the generator that wrote this file did not know
 * about the field". For a field a composing app reasons about — `dependencyKeys`, which decides
 * whether a cross-package subtree walk can see anything at all — that difference is the difference
 * between a real verdict and a blind one, so it is declared positively.
 *
 * `"dependencyKeys"`: this manifest's generator knows the `dependencyKeys` field and emits it where
 * it has keys to emit. A CAPABILITY claim, and deliberately nothing more: `dependencyKeys` is
 * derived syntactically from the factory's first parameter, so a unit written `(deps: Deps)` —
 * idiomatic, and not a mistake — carries no keys while demanding plenty, and is indistinguishable
 * from a unit that demands nothing. Every manifest this generator has ever written declares it.
 *
 * `"dependencyKeysComplete"`: every unit in `contracts` had its demand set actually DETERMINED at
 * generation, so on this manifest absence of `dependencyKeys` means "demands nothing" and nothing
 * else. A COVERAGE claim, computed per manifest — one factory whose parameter could not be read
 * withholds it. This is the only token that licenses a consumer to walk a subtree through this
 * package and call the result complete; see `verifyScopeRoots`' composed blind-spot advisory.
 *
 * The two are separate tokens rather than one because the weaker claim was shipped first, under
 * the stronger claim's wording, and a manifest already on disk cannot be asked to take it back.
 * Splitting them lets a consumer distrust the old claim without having to distrust the field.
 *
 * `"lifetimeSource"`: this manifest's generator knows the `lifetimeSource` field and emits it for
 * every unit whose plan carried provenance. A CAPABILITY claim, worded like `"dependencyKeys"` and
 * emitted unconditionally like it — but, unlike it, total in practice, which is why it has no
 * coverage sibling. Provenance resolution cannot come up empty on a unit the way key extraction
 * can: `resolvePlanLifetime` ends at `"default"`, a real answer meaning "nothing declared one",
 * rather than at a gap. So on every manifest this generator writes, absence of `lifetimeSource`
 * means the file predates the field and nothing else.
 *
 * A second token would therefore carry no information, and this vocabulary is published — a token
 * added is a token every future reader must go on honoring. If a plan ever DOES reach the writer
 * without provenance, the cost is bounded and visible: `explain` still says "provenance not
 * recorded in the manifest", it just loses the sharper "regenerate <package>" remedy that this
 * token's absence would have licensed. That is a duller sentence, not a false one.
 */
export type IocManifestFeature =
  | "dependencyKeys"
  | "dependencyKeysComplete"
  | "lifetimeSource";

/**
 * The name of the sibling export a generated manifest declares its features under.
 *
 * A SIBLING export, deliberately, rather than a property of `iocManifest` — exactly like
 * `IOC_SCOPE_PROVIDED_KEYS`. Every top-level property of `iocManifest` that is not in
 * {@link IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS} is read back as a GROUP ROOT, by this
 * version of the runtime and by every earlier one. Putting the marker inside the object would make
 * a manifest written today unreadable by an older runtime that has not learned the new fixed key —
 * a library publishing to apps it does not control cannot risk that. Outside the object, an older
 * runtime never sees it, and generation (which parses this file as SOURCE, not as an import) reads
 * it with no trouble at all.
 */
export const IOC_MANIFEST_FEATURES_EXPORT_NAME = "IOC_MANIFEST_FEATURES";

/**
 * Every feature token this generator knows how to write.
 *
 * NOT the list any given manifest declares. A coverage token like `"dependencyKeysComplete"` is
 * true of a manifest or it is not, so the emitted list is computed per manifest by
 * {@link iocManifestFeaturesFor}. This constant emitted verbatim is exactly the overclaim that
 * token exists to correct — it is kept only as the canonical vocabulary.
 */
export const IOC_MANIFEST_FEATURES: readonly IocManifestFeature[] = [
  "dependencyKeys",
  "dependencyKeysComplete",
  "lifetimeSource",
];

/** What a generation run learned about its own coverage, per feature that has any. */
export type IocManifestFeatureCoverage = {
  /**
   * True when every unit reaching `contracts` had its cradle-key demand set determined — including
   * the units that turned out to demand nothing. False when even one deps parameter could not be
   * read.
   */
  readonly dependencyKeysComplete: boolean;
};

/**
 * The feature list one generated manifest may honestly declare.
 *
 * Capability tokens are unconditional; coverage tokens are earned. Ordered as
 * {@link IOC_MANIFEST_FEATURES} lists them so generated output stays byte-stable.
 */
export const iocManifestFeaturesFor = (
  coverage: IocManifestFeatureCoverage,
): readonly IocManifestFeature[] =>
  IOC_MANIFEST_FEATURES.filter(
    (feature) =>
      feature !== "dependencyKeysComplete" || coverage.dependencyKeysComplete,
  );

/**
 * One scope-root variant's emitted opener (scope-roots stage 3).
 *
 * A variant claims no cradle key of its own — the OPENER does, and this row is what the runtime
 * needs to register it: which module exports the variant factory, the key the opener is reachable
 * under, the key the variant is registered under *inside* the child scope, and the declared
 * late-bound values the opener must register there before resolving.
 *
 * `lbvKeys` is the declared set, verbatim from the variant's `ScopeRoot<C, TLbv>` type argument —
 * never a set derived from the subtree. See `docs/design/scope-roots.md`.
 */
export type ScopeRootVariantManifestMetadata = {
  /** Registration unit kind. Omitted for factories (see {@link iocUnitKindOf}). */
  kind?: IocUnitKind;
  /** Exported factory identifier, e.g. `buildAuthRouter`. */
  exportName: string;
  /** Cradle key the opener is registered under, e.g. `openAuthRouterScope`. */
  openerKey: string;
  /** Key the variant is registered under inside the opened child scope, e.g. `authRouter`. */
  variantKey: string;
  /** Root contract resolved from the scope. */
  contractName: string;
  /** Variant identity within the root contract's variant set (the derived implementation name). */
  variantName: string;
  /** Path relative to `src/`, informational. */
  modulePath: string;
  /** Relative import path from the generated manifest directory to the source file. */
  relImport: string;
  /** Declared late-bound-value keys, sorted. Registered `asValue` on the child scope at open. */
  lbvKeys: readonly string[];
  /** Index into the parallel `moduleImports` array. */
  moduleIndex: number;
};

/** Scope roots by root contract, then by variant name — the same contract-first shape `contracts` uses. */
export type IocScopeRootsManifest = Record<
  string,
  Record<string, ScopeRootVariantManifestMetadata>
>;

/**
 * Fixed top-level keys on the generated container manifest; group roots must not use these names.
 *
 * `scopeRoots` is here for the same reason `contracts` is: group roots are "every top-level key that
 * is not fixed", so a new structural field must be named here or it would be read back as a group.
 */
export const IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS: ReadonlySet<string> =
  new Set(["manifestSchemaVersion", "moduleImports", "contracts", "scopeRoots"]);

/**
 * Core shape every generated container manifest includes. Configured group roots are emitted
 * as additional top-level properties alongside these.
 */
export type IocGeneratedContainerManifestCore = {
  readonly manifestSchemaVersion: ManifestSchemaVersion;
  readonly moduleImports: readonly IocModuleNamespace[];
  readonly contracts: IocContractManifest;
  /**
   * Emitted openers, one per scope-root variant. Optional and omitted entirely when the package
   * declares no scope roots, so a manifest without them is byte-identical to a pre-stage-3 one.
   */
  readonly scopeRoots?: IocScopeRootsManifest;
};

/**
 * Primary generated container description: module imports, canonical contract manifest, and
 * configured group roots as top-level entries.
 *
 * `TGroupRoots` is intentionally loose (`Record<string, unknown>`): the emitted
 * `IocManifestGroupRoots` helper uses `readonly` tuple literals that are not always assignable to
 * `IocGroupsManifest`’s mutable `Record`/`array` types, while still matching the runtime shape.
 */
export type IocGeneratedContainerManifest<
  TGroupRoots extends Record<string, unknown> = Record<never, never>,
> = IocGeneratedContainerManifestCore & Readonly<TGroupRoots>;

/**
 * Full generated container manifest accepted by `registerIocFromManifest`: `moduleImports`,
 * `contracts`, and any extra top-level group-root entries emitted by codegen.
 */
export type IocRegisterableManifest = IocGeneratedContainerManifestCore &
  Record<string, unknown>;

/** One implementation slot in a generated group (collection item or object property value). */
export type IocGroupLeafManifest = {
  contractName: string;
  registrationKey: string;
  /**
   * When the group's base type is generic, the source text of the type argument this member binds
   * to the base (e.g. `"album.shared"`). Captured for record/introspection; the bounded collection
   * cradle type is emitted from the group's declared arg, not per-member args. Omitted for
   * non-generic groups.
   */
  typeArgument?: string;
};

/** Collection group: ordered list of implementations to resolve from the cradle. */
export type IocGroupCollectionManifest = IocGroupLeafManifest[];

/** Object group: property keys are contract keys (default implementation resolved per leaf `registrationKey`). */
export type IocGroupObjectManifest = Record<string, IocGroupLeafManifest>;

/** Member payload only (array or object of leaves); used inside {@link IocGroupRootManifest}. */
export type IocGroupNodeManifest =
  | IocGroupCollectionManifest
  | IocGroupObjectManifest;

export type IocGroupKind = "collection" | "object";

/**
 * Generated top-level group root. Carries composition metadata plus member leaves. `baseTypeId`
 * is package-relative since schema v3 (see `packageRelativeDeclarationPath`).
 */
export type IocGroupRootManifest = {
  readonly kind: IocGroupKind;
  /** Human-readable name from `ioc.config` `groups.<name>.baseType`. */
  readonly baseType: string;
  /** Opaque canonical identifier for cross-manifest base-type matching (§8.1). */
  readonly baseTypeId: string;
  /**
   * Source text of the type argument declared for a generic `baseType` in `ioc.config`
   * (`groups.<name>.baseTypeArg`). Present only for groups over a generic base with a declared arg;
   * drives the bounded collection cradle type `ReadonlyArray<baseType<baseTypeArg>>`.
   */
  readonly baseTypeArg?: string;
  readonly members: IocGroupNodeManifest;
};

export type IocGroupsManifest = Record<string, IocGroupRootManifest>;
