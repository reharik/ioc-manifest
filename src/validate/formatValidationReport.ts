import type { ValidationIssue } from "./types.js";

export type ValidationReport = {
  readonly issues: readonly ValidationIssue[];
  readonly errorCount: number;
  readonly warningCount: number;
};

export const buildValidationReport = (
  issues: readonly ValidationIssue[],
): ValidationReport => {
  let errorCount = 0;
  let warningCount = 0;
  for (const issue of issues) {
    if (issue.severity === "error") {
      errorCount += 1;
    } else {
      warningCount += 1;
    }
  }
  return { issues, errorCount, warningCount };
};

const formatIssueText = (issue: ValidationIssue): string => {
  const lines: string[] = [
    `[${issue.category}] ${issue.summary}`,
    ...issue.details.map((d) => `  ${d}`),
  ];
  if (issue.suggestedFix !== undefined) {
    lines.push(`  Suggested fix: ${issue.suggestedFix}`);
  }
  return lines.join("\n");
};

export const formatValidationReportText = (report: ValidationReport): string => {
  if (report.issues.length === 0) {
    return "Validation passed: no issues found.";
  }

  const body = report.issues.map(formatIssueText).join("\n\n");
  const summary =
    report.errorCount > 0
      ? `Validation failed: ${report.errorCount} error${report.errorCount === 1 ? "" : "s"}, ${report.warningCount} warning${report.warningCount === 1 ? "" : "s"}.`
      : `Validation passed with ${report.warningCount} warning${report.warningCount === 1 ? "" : "s"}.`;

  return `${body}\n\n${summary}`;
};

/** Stable JSON schema for `--json` (public CLI API). */
export const formatValidationReportJson = (
  report: ValidationReport,
): string => JSON.stringify(report.issues, null, 2);
