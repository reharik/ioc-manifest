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

  for (const slice of compositionCtx.slices) {
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

        issues.push({
          category: "externals",
          severity: "error",
          summary: `Unsatisfied: nothing supplies ${JSON.stringify(externalKey)}, which ${sliceLabel(slice)} expects the container to already have.`,
          details: [
            `key:       ${JSON.stringify(externalKey)}  demanded by ${sliceLabel(slice)}`,
            `demanded:  ${demandedText}`,
            "No composed manifest offers this key in its IocGeneratedCradle.",
          ],
          suggestedFix:
            `Register a factory for ${demandedText} under key ${JSON.stringify(externalKey)} in this app, or compose another manifest that supplies it.`,
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
