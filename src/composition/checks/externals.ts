import type ts from "typescript";
import type { ParsedManifestSlice, CompositionContext, ValidationIssue } from "../types.js";
import {
  buildSkippedComparisonsIssue,
  type SkippedComparison,
} from "./registryIntegrity.js";
import { createCompositionProgram } from "../compositionProgram.js";
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
  slice.sourceId === "local"
    ? `${slice.packageLabel} local cradle`
    : `${slice.packageLabel}`;

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
  summary: `[externals] Key ${JSON.stringify(externalKey)} supplied by ${suppliers.map((s) => formatSupplierLabel(s)).join(", ")} (demanded by ${slice.packageLabel})`,
  details: [caveat],
});

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
          demandedBy: slice.packageLabel,
          taintedByPaths,
        });
        continue;
      }

      if (suppliers.length === 0) {
        issues.push({
          category: "externals",
          severity: "error",
          summary: `[externals] Unsatisfied: key ${JSON.stringify(externalKey)} demanded by ${slice.packageLabel}`,
          details: [
            `demanded:  ${demandedText}`,
            "No manifest in composedManifests supplies this key in IocGeneratedCradle.",
          ],
          suggestedFix:
            `Register a factory for ${demandedText} under key ${JSON.stringify(externalKey)} in this app, or compose another manifest that supplies it.`,
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
        summary: `[externals] Unsatisfied: key ${JSON.stringify(externalKey)} demanded by ${slice.packageLabel}`,
        details: [
          "Supplied by a composed manifest or local cradle, but the types are incompatible.",
          ...buildTypeMismatchDetails(
            typeCheckerCtx,
            suppliers,
            slice,
            externalKey,
            demandedText,
          ),
        ],
        suggestedFix:
          `Align the IocGeneratedCradle type for key ${JSON.stringify(externalKey)} with the demanded ${demandedText}, or adjust the external declaration in ${slice.packageLabel}.`,
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
