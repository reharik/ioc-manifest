/**
 * @fileoverview `ioc validate` — the composition suite WITHOUT REGENERATING.
 *
 * ### What this verb is for, now that generate runs the same checks
 *
 * `ioc generate` in app mode runs the whole composition suite as part of generation (see
 * `composition/runCompositionChecks.ts`): everything gen can know, gen enforces. This verb exists
 * for the cases where regenerating is not what you want to do:
 *
 * - CI over COMMITTED artifacts — prove the manifests in the repo compose, without writing files
 *   and without a diff to reconcile afterwards.
 * - Checking an app against a REBUILT DEPENDENCY — a library republished its manifest; does this
 *   app still compose against it? Answerable without touching the app's own source or output.
 *
 * It is the same checks, over the same program shape, reading committed files instead of pending
 * ones. It does not modify anything, and it aggregates every issue before exiting so CI can print
 * a full fix list.
 */
import type { IocConfig } from "../config/iocConfig.js";
import { isAppMode } from "../config/iocMode.js";
import {
  buildValidationReport,
  formatValidationReportJson,
  formatValidationReportText,
  type ValidationReport,
} from "../composition/compositionReport.js";
import { loadCompositionContext } from "../composition/compositionContext.js";
import { runCompositionChecks } from "../composition/runCompositionChecks.js";
import {
  formatStalenessBanner,
  readGenerationState,
  type IocGenerationStateMarker,
} from "../diagnostics/generationState.js";
import {
  formatFreshnessAdvisory,
  formatFreshnessBanner,
  formatFreshnessOrderingHint,
  isLocalFreshness,
  isStale,
  isUnknown,
  type PackageFreshness,
} from "../diagnostics/freshness.js";
import {
  applyFreshnessTaint,
  assessFreshness,
} from "../composition/freshnessPass.js";
import {
  mergeManifestOptionsWithIocConfig,
  resolveManifestOptions,
} from "../generator/manifestOptions.js";

export type RunValidateInput = {
  readonly projectRoot: string;
  readonly configPath: string;
  readonly config: IocConfig;
  readonly json: boolean;
};

export type RunValidateResult =
  | { readonly kind: "library-mode" }
  | { readonly kind: "load-error"; readonly message: string; readonly detail?: string }
  | {
      readonly kind: "report";
      readonly report: ValidationReport;
      /**
       * Present when the last generation attempt in this package FAILED.
       *
       * The report below it is still correct — it describes the artifacts on disk — but those
       * artifacts are the last successful write, not the current sources, and a reader comparing
       * this output against a generation error needs to be told which moment each describes.
       */
      readonly staleness?: IocGenerationStateMarker;
      /**
       * One verdict per package — this app and each composed dependency — on whether its artifacts
       * may predate its sources.
       *
       * Always present in `report` results, including when everything is current: the caller
       * decides what to print, and "nothing to say" is a thing this pass can conclude. It is
       * separate from {@link staleness} because they are different claims — see the field's own
       * documentation on the JSON options type.
       */
      readonly freshness: readonly PackageFreshness[];
    };

export const LIBRARY_MODE_VALIDATE_MESSAGE =
  "Library mode — no cross-manifest validation to perform. Run `ioc inspect` for a package-local manifest summary.";

export const runValidate = async (
  input: RunValidateInput,
): Promise<RunValidateResult> => {
  if (!isAppMode(input.config)) {
    return { kind: "library-mode" };
  }

  const loaded = await loadCompositionContext({
    projectRoot: input.projectRoot,
    configPath: input.configPath,
    config: input.config,
  });

  if (!loaded.ok) {
    return {
      kind: "load-error",
      message: loaded.message,
      detail: loaded.detail,
    };
  }

  const issues = runCompositionChecks(input.config, loaded.context);
  const staleness = readGenerationState(
    mergeManifestOptionsWithIocConfig(
      resolveManifestOptions({ paths: { projectRoot: input.projectRoot } }),
      input.config,
    ).paths.generatedDir,
  );

  // The LOCAL package is judged too. This verb reports on committed artifacts rather than on the
  // sources beside them, so the app's own output can be behind its own source exactly the way a
  // dependency's can — and the reader has no other way to find that out.
  const freshness = await assessFreshness({
    projectRoot: input.projectRoot,
    configPath: input.configPath,
    config: input.config,
    slices: loaded.context.slices,
    includeLocal: true,
  });

  return {
    kind: "report",
    report: buildValidationReport(applyFreshnessTaint(issues, freshness)),
    freshness,
    ...(staleness !== undefined ? { staleness } : {}),
  };
};

/**
 * The freshness banners, above the report, on stderr.
 *
 * stderr and not stdout, unlike the staleness banner's stream-follows-severity rule: this is a
 * caveat ABOUT the report rather than part of it, and `ioc validate --json | jq` is not the only
 * pipeline that captures stdout. A caveat that rode along inside a captured payload would corrupt
 * it; one that vanished into a pipe would be a caveat nobody reads.
 *
 * Two tiers, and they are not the same volume. A package with a mismatching fingerprint gets the
 * banner. A package that could not be judged gets one quiet line — absence of evidence is not
 * evidence, and rendering it at banner volume would spend the reader's alarm on a non-event and
 * teach them to skip the loud one.
 */
const printFreshness = (freshness: readonly PackageFreshness[]): void => {
  const stale = freshness.filter(isStale);
  const staleComposed = stale.filter((entry) => !isLocalFreshness(entry));

  for (const entry of stale) {
    console.error(formatFreshnessBanner(entry));
  }

  // Only when BOTH sides are behind. Regenerating this app first would compose the dependency's old
  // manifest and produce a fresh-looking artifact built on stale input — the same wrongness with
  // the warning removed.
  if (staleComposed.length > 0 && stale.length > staleComposed.length) {
    console.error(
      formatFreshnessOrderingHint(staleComposed.map((entry) => entry.name)),
    );
  }

  for (const entry of freshness.filter(isUnknown)) {
    console.error(formatFreshnessAdvisory(entry));
  }

  if (stale.length > 0 || freshness.some(isUnknown)) {
    console.error("");
  }
};

export const printValidateResult = (
  result: RunValidateResult,
  json: boolean,
): number => {
  if (result.kind === "library-mode") {
    console.log(LIBRARY_MODE_VALIDATE_MESSAGE);
    return 0;
  }

  if (result.kind === "load-error") {
    console.error(`[app-config] ${result.message}`);
    if (result.detail !== undefined) {
      console.error(`  ${result.detail}`);
    }
    return 1;
  }

  const { report, staleness, freshness } = result;
  const text = json
    ? formatValidationReportJson(report, { staleness, freshness })
    : formatValidationReportText(report);

  // The banner goes FIRST, and on the same stream as the report it qualifies. A reader who sees
  // the issues before the caveat has already started acting on them.
  if (!json && staleness !== undefined) {
    const banner = formatStalenessBanner(staleness);
    if (report.errorCount > 0 || report.warningCount > 0) {
      console.error(`${banner}\n`);
    } else {
      console.log(`${banner}\n`);
    }
  }

  if (!json) {
    printFreshness(freshness);
  }

  if (report.errorCount > 0 || report.warningCount > 0) {
    console.error(text);
  } else {
    console.log(text);
  }

  return report.errorCount > 0 ? 1 : 0;
};
