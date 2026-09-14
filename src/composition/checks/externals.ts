import type ts from "typescript";
import type { ParsedManifestSlice, CompositionContext, ValidationIssue } from "../types.js";
import {
  buildSkippedComparisonsIssue,
  type SkippedComparison,
} from "./registryIntegrity.js";
import { createCompositionProgram } from "../compositionProgram.js";
import { isLocalSlice, sliceLabel } from "../sliceLabel.js";
import {
  buildComposedGroupKeyIndex,
  type ComposedGroupKeyHit,
} from "../composedGroupIndex.js";
import { docsUrlForCode } from "../../diagnostics/errorDocs.js";
import { groupKeyToTypeAliasName } from "../../generator/naming.js";
import {
  findFirstMismatchedPropertyAcrossSuppliers,
  formatCheckerType,
  formatSupplierTypes,
  getInterfacePropertyType,
  getSupplierPropertyTypes,
  isSuppliedAssignableToDemandedTypes,
} from "../typeComparison.js";
import type { CompositionProgramContext } from "../compositionProgram.js";
import {
  classifyExternalReachability,
  type ComposedGraphUnit,
  type ComposedResolutionGraph,
  type ScopeVariantReach,
  type UnsuppliedDemand,
} from "../composedResolutionGraph.js";

type SupplierSlice = ParsedManifestSlice;

export const CHECKER_UNAVAILABLE_CAVEAT =
  "Type compatibility not verified (no TypeScript checker available) — run `tsc` for the authoritative result.";

export const TYPE_NOT_RESOLVED_CAVEAT =
  "Type compatibility could not be verified for this key — run `tsc` for the authoritative result.";

const formatSupplierLabel = (slice: SupplierSlice): string =>
  isLocalSlice(slice) ? `${sliceLabel(slice)} cradle` : sliceLabel(slice);

/**
 * The packages an externals verdict rests on: the one that demanded the key, and every one that
 * supplies it.
 *
 * Both halves, because either can be the stale one. A demand that looks unsatisfied may come from a
 * demander whose artifacts predate the source that stopped demanding it; a type mismatch may come
 * from a supplier whose artifacts predate the source that fixed the type.
 */
const attributionFor = (
  slice: ParsedManifestSlice,
  suppliers: readonly SupplierSlice[] = [],
): readonly string[] => [
  ...new Set([slice.sourceId, ...suppliers.map((s) => s.sourceId)]),
];

const findSuppliersForKey = (
  slices: readonly ParsedManifestSlice[],
  externalKey: string,
): SupplierSlice[] =>
  slices.filter((slice) => slice.cradleKeys.has(externalKey));

const getSuppliedTypeText = (
  suppliers: readonly SupplierSlice[],
  externalKey: string,
): string => {
  const typeTexts = suppliers
    .map((slice) => slice.cradleTypes[externalKey]?.typeText)
    .filter((text): text is string => text !== undefined);

  if (typeTexts.length === 0) {
    return "unknown";
  }
  if (typeTexts.length === 1) {
    return typeTexts[0]!;
  }
  return typeTexts.map((text) => `(${text})`).join(" & ");
};

const resolveSuppliedType = (
  ctx: CompositionProgramContext | undefined,
  suppliers: readonly SupplierSlice[],
  externalKey: string,
): { readonly suppliedText: string; readonly supplierTypes: readonly ts.Type[] } => {
  const suppliedText = getSuppliedTypeText(suppliers, externalKey);

  if (ctx === undefined) {
    return { suppliedText, supplierTypes: [] };
  }

  const supplierTypes = getSupplierPropertyTypes(
    ctx,
    suppliers,
    "IocGeneratedCradle",
    externalKey,
  );
  if (supplierTypes.length === 0) {
    return { suppliedText, supplierTypes: [] };
  }

  return {
    suppliedText: formatSupplierTypes(ctx.checker, supplierTypes),
    supplierTypes,
  };
};

const resolveDemandedType = (
  ctx: CompositionProgramContext | undefined,
  slice: ParsedManifestSlice,
  externalKey: string,
  demandedText: string,
): { readonly demandedText: string; readonly demandedType?: ts.Type } => {
  if (ctx === undefined) {
    return { demandedText };
  }

  const demandedType = getInterfacePropertyType(
    ctx,
    slice.typesPath,
    "IocExternals",
    externalKey,
  );
  if (demandedType === undefined) {
    return { demandedText };
  }

  return {
    demandedText: formatCheckerType(ctx.checker, demandedType),
    demandedType,
  };
};

const canVerifyExternalKeyTypes = (
  ctx: CompositionProgramContext | undefined,
  suppliers: readonly SupplierSlice[],
  slice: ParsedManifestSlice,
  externalKey: string,
  demandedText: string,
): boolean => {
  if (ctx === undefined) {
    return false;
  }

  const { supplierTypes } = resolveSuppliedType(ctx, suppliers, externalKey);
  const { demandedType } = resolveDemandedType(ctx, slice, externalKey, demandedText);
  return supplierTypes.length > 0 && demandedType !== undefined;
};

const isExternalKeySatisfied = (
  ctx: CompositionProgramContext | undefined,
  suppliers: readonly SupplierSlice[],
  slice: ParsedManifestSlice,
  externalKey: string,
  demandedText: string,
): boolean | undefined => {
  if (
    !canVerifyExternalKeyTypes(ctx, suppliers, slice, externalKey, demandedText)
  ) {
    return undefined;
  }

  const { supplierTypes } = resolveSuppliedType(ctx, suppliers, externalKey);
  const { demandedType } = resolveDemandedType(ctx, slice, externalKey, demandedText);

  if (supplierTypes.length === 0 || demandedType === undefined) {
    return undefined;
  }

  return isSuppliedAssignableToDemandedTypes(
    ctx!.checker,
    demandedType,
    supplierTypes,
  );
};

const buildTypeMismatchDetails = (
  ctx: CompositionProgramContext | undefined,
  suppliers: readonly SupplierSlice[],
  slice: ParsedManifestSlice,
  externalKey: string,
  demandedText: string,
): string[] => {
  const supplierLabels = suppliers.map((s) => formatSupplierLabel(s)).join(", ");
  const { suppliedText, supplierTypes } = resolveSuppliedType(
    ctx,
    suppliers,
    externalKey,
  );
  const { demandedText: renderedDemanded, demandedType } = resolveDemandedType(
    ctx,
    slice,
    externalKey,
    demandedText,
  );

  const details = [
    `demanded:  ${renderedDemanded}`,
    `supplied:  ${suppliedText}   (from ${supplierLabels})`,
  ];

  if (
    ctx !== undefined &&
    supplierTypes.length > 0 &&
    demandedType !== undefined
  ) {
    const mismatchedProperty = findFirstMismatchedPropertyAcrossSuppliers(
      ctx.checker,
      demandedType,
      supplierTypes,
    );
    if (mismatchedProperty !== undefined) {
      details.push(
        `"${mismatchedProperty}": supplied type is not assignable to demanded type`,
      );
    }
  }

  return details;
};

const buildUnverifiedKeyWarning = (
  slice: ParsedManifestSlice,
  externalKey: string,
  suppliers: readonly SupplierSlice[],
  caveat: string,
): ValidationIssue => ({
  category: "externals",
  severity: "warning",
  // The category is printed by the renderer from `category`; repeating it here is what produced
  // the `[externals] [externals]` a consumer reported.
  summary: `A supplier for ${JSON.stringify(externalKey)} was found, but the types could not be compared.`,
  details: [
    `key:       ${JSON.stringify(externalKey)}  demanded by ${sliceLabel(slice)}`,
    `supplied by: ${suppliers.map((s) => formatSupplierLabel(s)).join(", ")}`,
    caveat,
  ],
  packages: attributionFor(slice, suppliers),
});

/**
 * The grouped mirror of codegen's `grouped-member-demand`, for a key validate meets on disk.
 *
 * Reached only when NOTHING supplies the key, which for a grouped member is not drift but the rule
 * working: a grouped contract claims no individual cradle key, so nothing can supply one. The
 * generic externals remedy — "register a factory for it in this app" — would be a shadow of another
 * package's family member, and is exactly what the group law forbids. So the issue keeps its
 * category (a `grep '^\[externals\]'` still finds it) and its severity, and swaps its guidance.
 *
 * The regenerate hint is the third register and belongs here rather than in the docs: an app whose
 * artifacts still demand a member key is an app whose artifacts predate the grouping, and the fix
 * that actually reports the demand at its source is `ioc generate` in this package.
 */
const buildGroupedMemberIssue = (
  slice: ParsedManifestSlice,
  externalKey: string,
  demandedText: string,
  hit: ComposedGroupKeyHit,
): ValidationIssue => {
  const alias = groupKeyToTypeAliasName(hit.groupKey);
  const groupPhrase = hit.declaredByComposedPackage
    ? `composed group ${JSON.stringify(hit.groupKey)}`
    : `group ${JSON.stringify(hit.groupKey)}`;

  const consume =
    hit.kind === "object" && hit.memberProperty !== undefined
      ? `Consume it through the group: \`${hit.groupKey}: ${alias}\`, then \`${hit.groupKey}.${hit.memberProperty}\`.`
      : `Consume it through the group: \`${hit.groupKey}: ${alias}\` — a collection group's members are individually anonymous by declaration, so ${JSON.stringify(externalKey)} names nothing.`;

  return {
    category: "externals",
    severity: "error",
    summary: `Unsatisfied: ${JSON.stringify(externalKey)} is a member of ${groupPhrase} and has no individual cradle key.`,
    details: [
      `key:       ${JSON.stringify(externalKey)}  demanded by ${sliceLabel(slice)}`,
      `demanded:  ${demandedText}`,
      `group:     ${JSON.stringify(hit.groupKey)}  (kind: ${hit.kind}, declared by ${hit.declaredBy})`,
      ...(hit.contractName !== undefined
        ? [`contract:  ${JSON.stringify(hit.contractName)}`]
        : [`base:      ${JSON.stringify(hit.baseType)}`]),
      "A grouped contract is consumed through its group and through nothing else — it has no contract key and its implementations claim no individual cradle keys.",
      consume,
      `This app's generated artifacts predate the grouping: re-run \`ioc generate\` here, which reports the demand at its source.`,
    ],
    suggestedFix: `Demand the group (\`${hit.groupKey}: ${alias}\`) instead of the member key, then re-run \`ioc generate\` in this app.`,
    // The group's DECLARER as well as the demander: this finding says "that package groups this
    // contract", which is a claim read straight out of the declarer's manifest — so if the
    // declarer's artifacts predate its sources, this is exactly the finding that turns out wrong.
    packages: [...new Set([slice.sourceId, hit.declaredBySourceId])],
    // The rule broken here is the group law, not the externals contract, so the pointer goes there
    // — the same code the codegen-side door links to.
    ...(docsUrlForCode("grouped-member-demand") !== undefined
      ? { docUrl: docsUrlForCode("grouped-member-demand")! }
      : {}),
  };
};

/** Where a demand was made, in the reader's terms: which export, in which file, in which package. */
const demandSiteLabel = (unit: ComposedGraphUnit): string =>
  `${JSON.stringify(unit.exportName)} in ${unit.modulePath} (${unit.packageLabel})`;

/** `variantName → registrationKey → … → key`, the path the walk actually took. */
const viaLine = (demand: UnsuppliedDemand, externalKey: string): string =>
  [...demand.via, externalKey].join(" → ");

/**
 * The scope-reachable finding: an obligation that does not come due at composition.
 *
 * `undefined` when every variant that reaches the key already carries it — which is a PASS, and the
 * ordinary outcome once a consumer has declared the value. The check must not leave a residue
 * behind on the way to saying nothing is wrong.
 *
 * The variants named are only the unsatisfied ones. A variant that declares the key has nothing to
 * fix, and listing it under a failure teaches the reader to skim the list they are meant to act on.
 */
const buildScopeReachableIssue = (
  slice: ParsedManifestSlice,
  externalKey: string,
  demandedText: string,
  reaches: readonly ScopeVariantReach[],
): ValidationIssue | undefined => {
  const unsatisfied = reaches.filter((reach) => !reach.satisfied);
  if (unsatisfied.length === 0) {
    return undefined;
  }

  const demandSites = [
    ...new Set(reaches.map((reach) => demandSiteLabel(reach.demand.demandedBy))),
  ];

  const variantBlocks = unsatisfied.flatMap((reach) => [
    "",
    `  ${reach.variant.contractName} / ${reach.variant.variantName}`,
    `    (${reach.variant.modulePath}, export ${JSON.stringify(reach.variant.exportName)})`,
    `    via: ${viaLine(reach.demand, externalKey)}`,
    // The manifest records the declared SET, not the declared types — `lbvKeys` is a key list, and
    // rendering a type here would mean inventing one. Named as keys so nobody reads it as a type.
    `    declared lbv keys: ${reach.variant.declaredLbvKeys.length === 0 ? "(none)" : reach.variant.declaredLbvKeys.join(", ")}`,
    `    fix: add \`${externalKey}: ${demandedText}\` to the ScopeRoot<${reach.variant.contractName}, ...> late-bound-value set on ${JSON.stringify(reach.variant.exportName)}`,
  ]);

  return {
    category: "externals",
    severity: "error",
    summary: `Unsatisfied: ${JSON.stringify(externalKey)} is scope-reachable only, and ${unsatisfied.length} of the ${reaches.length} scope root variant${reaches.length === 1 ? "" : "s"} that reach it ${unsatisfied.length === 1 ? "does" : "do"} not carry it.`,
    details: [
      `key:       ${JSON.stringify(externalKey)}  demanded by ${sliceLabel(slice)}`,
      `demanded:  ${demandedText}`,
      ...demandSites.map((site) => `demanded by ${site}`),
      "Every resolution path that reaches this key crosses a scope boundary, so the root container is never asked for it. It is a late-bound value of the scopes that reach it, not a composition-level external — a value bound at scope-open is never in the composed cradle, and registering one on the root container would not satisfy these paths.",
      `Propagated to ${reaches.length} scope root variant${reaches.length === 1 ? "" : "s"}. Unsatisfied at ${unsatisfied.length}:`,
      ...variantBlocks,
    ],
    suggestedFix: `Add ${JSON.stringify(externalKey)} to the declared late-bound-value set of each variant listed above (or name it in \`scopeProvided\` if every scope in this app carries it).`,
    packages: [
      ...new Set([
        slice.sourceId,
        ...unsatisfied.map((reach) => reach.variant.sourceId),
      ]),
    ],
    ...(docsUrlForCode("scope-reachable-external") !== undefined
      ? { docUrl: docsUrlForCode("scope-reachable-external")! }
      : {}),
  };
};

/**
 * Mixed reachability: one path reaches the key from a composition root, another only through a
 * scope.
 *
 * A hard error, and the root path is what the message is about. The scope paths are real and a
 * declaration there is a real fix for THEM — but it does nothing for the root path, which still
 * resolves to nothing, and a message that led with the scope half would read as "declare it
 * somewhere and this goes away". It does not.
 */
const buildMixedReachabilityIssue = (
  slice: ParsedManifestSlice,
  externalKey: string,
  demandedText: string,
  rootDemands: readonly UnsuppliedDemand[],
  reaches: readonly ScopeVariantReach[],
): ValidationIssue => ({
  category: "externals",
  severity: "error",
  summary: `Unsatisfied: nothing supplies ${JSON.stringify(externalKey)}, which ${sliceLabel(slice)} expects the container to already have, and a resolution path reaches it from a composition root.`,
  details: [
    `key:       ${JSON.stringify(externalKey)}  demanded by ${sliceLabel(slice)}`,
    `demanded:  ${demandedText}`,
    "No composed manifest offers this key in its IocGeneratedCradle.",
    ...rootDemands.flatMap((demand) => [
      `root path: ${viaLine(demand, externalKey)}`,
      `           demanded by ${demandSiteLabel(demand.demandedBy)}`,
    ]),
    `This key is ALSO reached under ${reaches.length} scope root variant${reaches.length === 1 ? "" : "s"}, where a late-bound value can carry it. That does not settle the path above: a value bound at scope-open never enters the root cradle, so the root path still resolves to nothing. Fix the root path.`,
  ],
  suggestedFix: `Register a factory for ${demandedText} under key ${JSON.stringify(externalKey)} in this app, or stop resolving the root-side consumer outside a scope so every path to ${JSON.stringify(externalKey)} crosses a scope boundary.`,
  packages: attributionFor(slice),
  ...(docsUrlForCode("scope-reachable-external") !== undefined
    ? { docUrl: docsUrlForCode("scope-reachable-external")! }
    : {}),
});

/**
 * Why one demanding factory is treated as root-resolvable, in the reader's terms.
 *
 * The distinction this draws is the difference between two entirely different afternoons. A unit
 * deliberately marked singleton is a design fact, and the fix is elsewhere. A unit that records
 * `"singleton"` only because its package declared no `lifetimeMarkers` is a CONFIG GAP: the base
 * class saying `extends RequestScopeLifeCycle` is inert in that package's generation, the manifest
 * row says singleton, and this rule can only read the row. Pointing at the missing block is the
 * whole fix, and a reader has no way to guess it from an unsatisfied-external message.
 *
 * The third case is the honest one: a manifest whose generator predates `lifetimeSource` records no
 * provenance at all, and absence there does NOT mean `"default"` — see `IOC_MANIFEST_FEATURES`.
 * Saying "not recorded" is the only thing that manifest supports.
 */
const blockerLifetimeNote = (unit: ComposedGraphUnit): string => {
  const lifetime = unit.lifetime ?? "(none recorded)";
  if (!unit.lifetimeProvenanceDeclared) {
    return `lifetime ${lifetime}; this manifest records no lifetime provenance`;
  }
  if (unit.lifetimeSource === "default") {
    return `lifetime ${lifetime} BY DEFAULT — nothing in ${unit.packageLabel} declared one`;
  }
  return `lifetime ${lifetime}${unit.lifetimeSource === undefined ? "" : ` (from ${unit.lifetimeSource})`}`;
};

/** True when a blocker is singleton only because its package declared no lifetime at all. */
const isDefaultLifetime = (unit: ComposedGraphUnit): boolean =>
  unit.lifetimeProvenanceDeclared && unit.lifetimeSource === "default";

/**
 * The detail lines explaining why an unreachable key was NOT cleared.
 *
 * "Not cleared" without saying why is the shape of message someone files an issue about: the reader
 * sees an unsatisfied external for a key nothing in their app appears to use, and has no way to
 * learn that one root-resolvable demander is the entire reason. So the demanders are named, with
 * the lifetime each one records and where that lifetime came from.
 */
const unreachableBlockedDetails = (
  blockedBy: readonly ComposedGraphUnit[],
  demanderCount: number,
): string[] => {
  if (demanderCount === 0) {
    return [
      "No resolution path reaches this key — but no composed unit records a demand for it either, so there is nothing to conclude from that silence and the obligation stands.",
    ];
  }
  return [
    `No resolution path reaches this key, but it is not cleared: ${blockedBy.length} of the ${demanderCount} factor${demanderCount === 1 ? "y" : "ies"} demanding it ${blockedBy.length === 1 ? "is" : "are"} resolvable from the root container, and a resolve from the app's composition root is not visible to this walk.`,
    ...blockedBy.map(
      (unit) =>
        `  ${demandSiteLabel(unit)} — ${blockerLifetimeNote(unit)}`,
    ),
    "A key demanded only by SCOPED factories is cleared instead: a root resolve cannot reach a scoped factory, so an unseen one cannot hide a path to the key.",
  ];
};

/**
 * The fix line for a not-cleared unreachable key.
 *
 * A default-lifetime blocker gets its own, because the generic "register a factory" remedy is the
 * wrong advice for it — the value is not missing, the lifetime is unread.
 */
const unreachableBlockedFix = (
  externalKey: string,
  demandedText: string,
  blockedBy: readonly ComposedGraphUnit[],
): string => {
  const defaults = blockedBy.filter(isDefaultLifetime);
  if (defaults.length === 0) {
    return `Register a factory for ${demandedText} under key ${JSON.stringify(externalKey)} in this app, or compose another manifest that supplies it.`;
  }
  const packages = [...new Set(defaults.map((unit) => unit.packageLabel))];
  return `Register a factory for ${demandedText} under key ${JSON.stringify(externalKey)} in this app — or, if ${packages.join(", ")} meant ${defaults.length === 1 ? "this factory" : "these factories"} to be scoped, add a \`lifetimeMarkers\` block to ${packages.length === 1 ? "its" : "their"} \`ioc.config\` and regenerate: without one the marker base class is inert and the manifest records a default singleton, which this check must read as root-resolvable.`;
};

export type CheckExternalsOptions = {
  /**
   * The program `checkRegistryIntegrity` already built and inspected. Shared so the gate and the
   * comparisons reason over the SAME program — a second program could disagree with the one whose
   * health was just adjudicated — and so each run builds it once.
   *
   * Present-but-`undefined` means "there is no program, and that is settled": the caller tried and
   * the workspace could not produce one. Only an ABSENT key makes this check build its own, which
   * production never does — `runCompositionChecks` always supplies the key.
   */
  readonly typeCheckerCtx?: CompositionProgramContext | undefined;
  /**
   * Types files that do not compile. Comparisons reading from one are skipped.
   *
   * Omitting this runs every comparison, which is only correct when the program is known healthy.
   * Production always goes through `runAllValidationChecks`, which supplies it.
   */
  readonly brokenTypesPaths?: ReadonlySet<string>;
  /**
   * The composed resolution graph, when the caller has one.
   *
   * Absent means "no graph was built", and every external is then judged as root-resolvable — the
   * behaviour this check had before reachability existed. Production always supplies it;
   * `runCompositionChecks` builds it once and shares it.
   */
  readonly graph?: ComposedResolutionGraph;
  /**
   * `ioc.config.scopeProvided` — keys the app has DECLARED enter at a scope boundary.
   *
   * Read only when settling a scope-reachable key at a variant: an explicit statement that a key is
   * carried by the scope satisfies the variants that reach it, the same way a declared lbv does. It
   * is deliberately not consulted on a root-reachable key — an explicit declaration cannot make a
   * root path resolve, and letting it try would turn the escape hatch into a way to silence a real
   * unsatisfied external.
   */
  readonly scopeProvidedKeys?: readonly string[];
};

export const checkExternalsSatisfaction = (
  compositionCtx: CompositionContext,
  options?: CheckExternalsOptions,
): ValidationIssue[] => {
  const typeCheckerCtx =
    options !== undefined && "typeCheckerCtx" in options
      ? options.typeCheckerCtx
      : createCompositionProgram({
          projectRoot: compositionCtx.projectRoot,
          sourceFiles: compositionCtx.sourceFiles,
          typesPaths: compositionCtx.slices.map((slice) => slice.typesPath),
        });
  const brokenTypesPaths = options?.brokenTypesPaths ?? new Set<string>();

  const issues: ValidationIssue[] = [];
  const skipped: SkippedComparison[] = [];
  const checkerUnavailable = typeCheckerCtx === undefined;
  // Built once: every unsatisfied key is asked the same question, and the roots do not change
  // during the run.
  const groupKeyIndex = buildComposedGroupKeyIndex(compositionCtx);
  const scopeProvidedKeys = new Set(options?.scopeProvidedKeys ?? []);

  for (const [sliceIndex, slice] of compositionCtx.slices.entries()) {
    for (const [externalKey, { typeText: demandedText }] of Object.entries(
      slice.externals,
    )) {
      const suppliers = findSuppliersForKey(compositionCtx.slices, externalKey);

      // Precise tainting: a key's verdict reads the DEMANDING slice's `IocExternals` and each
      // SUPPLYING slice's `IocGeneratedCradle`, and both file sets are already on the slices — so
      // the taint set is a lookup, not an analysis. A broken package therefore only withholds
      // verdicts on keys whose types it actually contributes; keys it has nothing to do with are
      // still adjudicated normally.
      const taintedByPaths = [
        slice.typesPath,
        ...suppliers.map((s) => s.typesPath),
      ].filter(
        (p, i, all) => brokenTypesPaths.has(p) && all.indexOf(p) === i,
      );
      if (taintedByPaths.length > 0) {
        // No verdict of any kind — satisfied, unsatisfied, or unverified. The types this key
        // would be judged on are not trustworthy, so the honest report is that nothing was judged.
        skipped.push({
          externalKey,
          demandedBy: sliceLabel(slice),
          taintedByPaths,
          packages: attributionFor(slice, suppliers),
        });
        continue;
      }

      if (suppliers.length === 0) {
        // Grouped ⇒ group-only, seen from the artifact side. Checked before the generic remedy is
        // composed, because for a grouped member that remedy names a forbidden fix.
        const groupHit = groupKeyIndex.get(externalKey);
        if (groupHit !== undefined) {
          issues.push(
            buildGroupedMemberIssue(slice, externalKey, demandedText, groupHit),
          );
          continue;
        }

        // WHEN the obligation comes due, before WHETHER it is met. The check below is correct in
        // what it checks and was wrong in when it demanded an answer: it treated every external as
        // root-resolvable, so it adjudicated at composition time a promise that is not owed until
        // scope-open — and no amount of registering could keep it.
        const reachability =
          options?.graph === undefined
            ? ({ kind: "unknown", blindSpots: [] } as const)
            : classifyExternalReachability(
                options.graph,
                externalKey,
                sliceIndex,
                scopeProvidedKeys,
              );

        // `unreachable-blocked` falls through to the ordinary unsatisfied error below, and the
        // reason it must is the whole reason the unrestricted unreachable rule was pulled twice.
        //
        // The walk's root seeds are the app's REGISTERED units, while an app's real resolution
        // roots are its composition root's own `container.resolve(...)` calls, and those are
        // recorded nowhere. `bootstrap.ts` is not a discovery target and has no manifest row. A
        // library unit the bootstrap resolves directly is therefore "unreachable" to this walk
        // while being the very thing the app runs on.
        //
        // Reproduced in `examples/multi-package`: give `buildUploadService` a new unsatisfied
        // external, regenerate the library, and `ioc validate` in the app reports "no issues found"
        // while the app throws `Could not resolve 'auditSink'` at the first resolve. No rest-spread,
        // no dynamic resolution, no container closure — just a composition root doing what the docs
        // show. Clearing on that inference trades a build error for a production one.
        //
        // What DOES clear is the case where every factory demanding the key is scoped — the
        // `unreachable` branch immediately below. A bootstrap resolve goes to the root container
        // and a root resolve cannot reach a scoped factory, so the unseen-root problem cannot
        // arise: there is no hidden path for the walk to have missed. The general case is
        // unchanged, and making IT sound still needs the resolution roots modelled, not more
        // falsifiers closed.
        if (reachability.kind === "unreachable") {
          continue;
        }

        if (reachability.kind === "scope-only") {
          const issue = buildScopeReachableIssue(
            slice,
            externalKey,
            demandedText,
            reachability.reaches,
          );
          if (issue !== undefined) {
            issues.push(issue);
          }
          continue;
        }

        if (reachability.kind === "mixed") {
          issues.push(
            buildMixedReachabilityIssue(
              slice,
              externalKey,
              demandedText,
              reachability.rootDemands,
              reachability.reaches,
            ),
          );
          continue;
        }

        issues.push({
          category: "externals",
          severity: "error",
          summary: `Unsatisfied: nothing supplies ${JSON.stringify(externalKey)}, which ${sliceLabel(slice)} expects the container to already have.`,
          details: [
            `key:       ${JSON.stringify(externalKey)}  demanded by ${sliceLabel(slice)}`,
            `demanded:  ${demandedText}`,
            "No composed manifest offers this key in its IocGeneratedCradle.",
            ...(reachability.kind === "unreachable-blocked"
              ? unreachableBlockedDetails(
                  reachability.blockedBy,
                  reachability.demanderCount,
                )
              : []),
          ],
          suggestedFix:
            reachability.kind === "unreachable-blocked"
              ? unreachableBlockedFix(
                  externalKey,
                  demandedText,
                  reachability.blockedBy,
                )
              : `Register a factory for ${demandedText} under key ${JSON.stringify(externalKey)} in this app, or compose another manifest that supplies it.`,
          // No suppliers to name — the whole finding is that there are none. The demander alone is
          // the package whose artifacts this rests on, and the one the field kept finding stale.
          packages: attributionFor(slice),
        });
        continue;
      }

      const satisfied = isExternalKeySatisfied(
        typeCheckerCtx,
        suppliers,
        slice,
        externalKey,
        demandedText,
      );

      if (satisfied === undefined) {
        issues.push(
          buildUnverifiedKeyWarning(
            slice,
            externalKey,
            suppliers,
            checkerUnavailable
              ? CHECKER_UNAVAILABLE_CAVEAT
              : TYPE_NOT_RESOLVED_CAVEAT,
          ),
        );
        continue;
      }

      if (satisfied) {
        continue;
      }

      issues.push({
        category: "externals",
        severity: "error",
        summary: `Unsatisfied: ${JSON.stringify(externalKey)} is supplied, but not with the type ${sliceLabel(slice)} demands.`,
        details: [
          `key:       ${JSON.stringify(externalKey)}  demanded by ${sliceLabel(slice)}`,
          "the supplied and demanded types are incompatible:",
          ...buildTypeMismatchDetails(
            typeCheckerCtx,
            suppliers,
            slice,
            externalKey,
            demandedText,
          ),
        ],
        suggestedFix:
          `Align the IocGeneratedCradle type for key ${JSON.stringify(externalKey)} with the demanded ${demandedText}, or adjust the external declaration in ${sliceLabel(slice)}.`,
        packages: attributionFor(slice, suppliers),
      });
    }
  }

  const skippedIssue = buildSkippedComparisonsIssue(
    compositionCtx.projectRoot,
    skipped,
  );
  if (skippedIssue !== undefined) {
    issues.push(skippedIssue);
  }

  return issues;
};
