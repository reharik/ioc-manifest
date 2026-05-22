/**
 * @fileoverview `ioc validate` orchestration — read-only cross-manifest checks (design §9.2).
 *
 * Unlike `ioc generate`, validate does not modify files. It aggregates every issue before exiting
 * so CI can print a full fix list. Run after `ioc generate` when composed package manifests exist.
 */
import type { IocConfig } from "../config/iocConfig.js";
import { isAppMode } from "../config/iocMode.js";
import { checkAppConfigSanity } from "./checks/appConfig.js";
import { checkDefaultAmbiguity } from "./checks/defaultAmbiguity.js";
import { checkExternalsSatisfaction } from "./checks/externals.js";
import { checkGroupConsistency } from "./checks/groups.js";
import { checkSameKeyConflicts } from "./checks/sameKeyConflict.js";
import { checkSchemaVersions } from "./checks/schemaVersion.js";
import {
  buildValidationReport,
  formatValidationReportJson,
  formatValidationReportText,
  type ValidationReport,
} from "./formatValidationReport.js";
import { loadValidateContext } from "./loadParsedManifests.js";
import type { ValidationIssue } from "./types.js";

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

export const runAllValidationChecks = (
  config: IocConfig,
  ctx: import("./types.js").ValidateContext,
): ValidationIssue[] => [
  ...checkSchemaVersions(ctx),
  ...checkExternalsSatisfaction(ctx),
  ...checkSameKeyConflicts(ctx),
  ...checkGroupConsistency(ctx),
  ...checkDefaultAmbiguity(ctx),
  ...checkAppConfigSanity(config, ctx),
];

export const runValidate = async (
  input: RunValidateInput,
): Promise<RunValidateResult> => {
  if (!isAppMode(input.config)) {
    return { kind: "library-mode" };
  }

  const loaded = await loadValidateContext(
    input.projectRoot,
    input.configPath,
    input.config,
  );

  if (!loaded.ok) {
    return {
      kind: "load-error",
      message: loaded.message,
      detail: loaded.detail,
    };
  }

  const issues = runAllValidationChecks(input.config, loaded.context);
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
