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

export type RunValidateInput = {
  readonly projectRoot: string;
  readonly configPath: string;
  readonly config: IocConfig;
  readonly json: boolean;
};

export type RunValidateResult =
  | { readonly kind: "library-mode" }
  | { readonly kind: "load-error"; readonly message: string; readonly detail?: string }
  | { readonly kind: "report"; readonly report: ValidationReport };

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
  return {
    kind: "report",
    report: buildValidationReport(issues),
  };
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

  const { report } = result;
  const text = json
    ? formatValidationReportJson(report)
    : formatValidationReportText(report);

  if (report.errorCount > 0 || report.warningCount > 0) {
    console.error(text);
  } else {
    console.log(text);
  }

  return report.errorCount > 0 ? 1 : 0;
};
