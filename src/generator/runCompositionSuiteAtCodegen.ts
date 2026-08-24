/**
 * @fileoverview App-mode generation runs the composition suite.
 *
 * ### Why generation judges what it composes
 *
 * **Everything gen can know, gen enforces; validate exists to run the same checks without
 * regenerating.**
 *
 * An app package's `generate` already composes: it loads composed manifests, emits
 * `ioc-composed.ts`, walks composed subtrees, and resolves composed opener and slot keys. It did
 * not JUDGE that composition — every compositional check lived only in `ioc validate`, a separate
 * verb. For the primary workflow, where generated output is not checked in and gen runs on every
 * change, `validate` structurally never runs, so the whole composition-checking layer was dead
 * code in practice: gen was passing while validation had all manner of errors.
 *
 * ### What runs, and when
 *
 * The suite is `composition/runCompositionChecks.ts` — the same module `ioc validate` calls, over
 * the same program construction. It runs LATE: after election, group planning, demand/supply,
 * scope-root verification and opener emission, and after the composed manifest source is built, so
 * it judges the real composed picture rather than a half-resolved one. It reads the artifacts this
 * run is about to write, not the previous run's output on disk.
 *
 * ### Failure shape
 *
 * One aggregated error carrying every finding, thrown before anything is written — the same
 * offender-bucket discipline the rest of codegen uses, and the same "nothing broken lands on disk"
 * rule the import-closure invariant established. Severity parity with validate is exact: what
 * validate calls an error fails generation, what validate calls a warning is printed and the run
 * continues.
 *
 * ### Library mode
 *
 * Nothing here runs, and nothing is skipped either — the information does not exist. Every check in
 * the suite adjudicates a relationship BETWEEN manifests (is this external supplied by a composed
 * cradle; do two packages disagree about a group's base type; is a default ambiguous across the
 * composed set). A library package has no composed set to relate to: its `IocExternals` is a
 * promise to whichever app composes it later, and that app's generate is the first run that can
 * say whether the promise is kept. Checking a library against itself would either say nothing or
 * say something false.
 */
import type { IocConfig } from "../config/iocConfig.js";
import { withOffenderCount } from "../diagnostics/offenderCount.js";
import {
  loadCompositionContext,
  type PendingLocalArtifacts,
} from "../composition/compositionContext.js";
import {
  buildValidationReport,
  formatValidationIssuesText,
} from "../composition/compositionReport.js";
import { runCompositionChecks } from "../composition/runCompositionChecks.js";
import {
  applyFreshnessTaint,
  assessFreshness,
} from "../composition/freshnessPass.js";
import {
  formatFreshnessAdvisory,
  formatFreshnessBanner,
  isStale,
  isUnknown,
} from "../diagnostics/freshness.js";
import type { ValidationIssue } from "../composition/types.js";
import type { IocTsconfigContext } from "./iocProgramContext.js";

export type CompositionSuiteAtCodegenInput = {
  readonly projectRoot: string;
  readonly configPath: string;
  readonly config: IocConfig;
  /** Discovery targets — the program's root set, so it is the app's build and not a synthetic one. */
  readonly sourceFiles: readonly string[];
  readonly pendingLocalArtifacts: PendingLocalArtifacts;
  readonly tsconfig: IocTsconfigContext;
};

export const COMPOSITION_SUITE_FAILURE_HEADER =
  "[ioc] App-mode generation refused: the composed picture this run would emit does not hold together.";

/**
 * The migration note, in the error itself.
 *
 * A previously-green `gen` can now go red on errors that were always there. Saying so at the point
 * of failure is the difference between "the tool broke" and "the tool started telling you".
 */
export const COMPOSITION_SUITE_FAILURE_FOOTER =
  "No files were written. These are real composition errors — `ioc validate` has always reported them; " +
  "app-mode generation now enforces the same checks rather than emitting output that composes wrongly. " +
  "Fix them, or run `ioc validate` for the same report without regenerating.";

const formatFailure = (
  issues: readonly ValidationIssue[],
  errorCount: number,
  warningCount: number,
): string =>
  [
    `${COMPOSITION_SUITE_FAILURE_HEADER} ${errorCount} error${errorCount === 1 ? "" : "s"}, ${warningCount} warning${warningCount === 1 ? "" : "s"}:`,
    "",
    formatValidationIssuesText(issues),
    "",
    COMPOSITION_SUITE_FAILURE_FOOTER,
  ].join("\n");

/**
 * Runs the suite and returns the issues it found, throwing ONE aggregated error when any is an
 * error-severity finding.
 *
 * Warnings are printed here rather than returned for the caller to print, so the wording is the
 * same whichever verb surfaced them.
 *
 * ### Freshness, composed packages only
 *
 * The composed manifests this run reads are somebody else's committed output, and the ordering
 * mistake the field kept making — edit the library, regenerate the app, forget to regenerate the
 * library — lands right here: the suite judges the app against a description of the library as it
 * was. So each composed package is checked and bannered.
 *
 * It never aborts. The finding may be perfectly real, and a generation that refused to run because
 * a dependency *might* be behind would be unusable in exactly the monorepo it is meant for. The
 * LOCAL package is not checked at all: this run is reading its sources right now and is about to
 * rewrite its artifacts from them.
 */
export const runCompositionSuiteAtCodegen = async (
  input: CompositionSuiteAtCodegenInput,
): Promise<readonly ValidationIssue[]> => {
  const loaded = await loadCompositionContext({
    projectRoot: input.projectRoot,
    configPath: input.configPath,
    config: input.config,
    pendingLocalArtifacts: input.pendingLocalArtifacts,
    sourceFiles: input.sourceFiles,
    tsconfig: input.tsconfig,
  });

  if (!loaded.ok) {
    throw new Error(
      [
        `[app-config] ${loaded.message}`,
        ...(loaded.detail !== undefined ? [`  ${loaded.detail}`] : []),
      ].join("\n"),
    );
  }

  const freshness = await assessFreshness({
    projectRoot: input.projectRoot,
    configPath: input.configPath,
    config: input.config,
    slices: loaded.context.slices,
    includeLocal: false,
  });
  for (const entry of freshness.filter(isStale)) {
    console.error(formatFreshnessBanner(entry));
  }
  for (const entry of freshness.filter(isUnknown)) {
    console.error(formatFreshnessAdvisory(entry));
  }

  const issues = applyFreshnessTaint(
    runCompositionChecks(input.config, loaded.context),
    freshness,
  );
  const report = buildValidationReport(issues);

  if (report.errorCount > 0) {
    throw withOffenderCount(
      new Error(
        formatFailure(report.issues, report.errorCount, report.warningCount),
      ),
      report.errorCount,
    );
  }

  if (report.warningCount > 0) {
    console.warn(
      `[ioc] Composition checks: ${report.warningCount} warning${report.warningCount === 1 ? "" : "s"}.\n${formatValidationIssuesText(report.issues)}`,
    );
  }

  return report.issues;
};
