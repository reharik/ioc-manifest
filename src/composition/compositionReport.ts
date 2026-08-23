/**
 * @fileoverview Rendering for the composition suite's findings.
 *
 * The TEXT body is shared by both verbs — `ioc validate` prints it, and app-mode `ioc generate`
 * carries it in the one aggregated error it throws — so a developer reads the same words about the
 * same problem whichever verb found it. Only the surrounding summary line differs, because
 * "validation failed" and "generation aborted, nothing written" are different outcomes.
 *
 * The JSON shape is `ioc validate --json`'s public CLI API and is emitted by that verb alone.
 *
 * ### The three registers
 *
 * Every issue renders in the same order, and the order is the point:
 *
 * 1. **What happened**, in a sentence, in the words a developer would use — `[category] Nothing
 *    supplies "logger" …`. No type text, no paths.
 * 2. **The mechanism**: the key, the package, the demanded and supplied types, the mismatching
 *    property. Dense on purpose. This is the part no documentation page can supply, because it is
 *    about this workspace at this moment.
 * 3. **Where the rule is written down**: `→ docs: <url>`, resolved from the category through
 *    `diagnostics/errorDocs.ts`. Nothing here writes a URL by hand.
 *
 * Colour follows the usual CLI rules (`NO_COLOR`, `FORCE_COLOR`, TTY) and is *empty* when disabled,
 * so plain output is byte-stable and the tests assert real text. It never reaches `--json`.
 */
import { resolveAnsi, type Ansi } from "../diagnostics/ansi.js";
import { docsUrlForCode } from "../diagnostics/errorDocs.js";
import type { ValidationIssue } from "./types.js";

export type ValidationReport = {
  readonly issues: readonly ValidationIssue[];
  readonly errorCount: number;
  readonly warningCount: number;
};

/**
 * Attaches the docs pointer for an issue's category, if there is one.
 *
 * Done at report-build time rather than at render time so the text output and `--json` cannot
 * disagree about where a category is documented — one lookup, both surfaces.
 */
const withDocUrl = (issue: ValidationIssue): ValidationIssue => {
  if (issue.docUrl !== undefined) {
    return issue;
  }
  const docUrl = docsUrlForCode(issue.category);
  return docUrl === undefined ? issue : { ...issue, docUrl };
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
  return { issues: issues.map(withDocUrl), errorCount, warningCount };
};

export type FormatValidationTextOptions = {
  /** When omitted, uses TTY + NO_COLOR / FORCE_COLOR (same idea as common CLIs). */
  color?: boolean;
};

/**
 * The category tag, always first on the line so `grep '^\[externals\]'` keeps working, and always
 * carrying its severity in words as well as in colour — a pipe into a file has no colour left.
 */
const categoryTag = (issue: ValidationIssue, c: Ansi): string => {
  const tint = issue.severity === "error" ? c.red : c.yellow;
  const severity = issue.severity === "error" ? "" : " (warning)";
  return `${c.bold}${tint}[${issue.category}]${severity}${c.reset}`;
};

const formatIssueText = (issue: ValidationIssue, c: Ansi): string => {
  const lines: string[] = [
    `${categoryTag(issue, c)} ${issue.summary}`,
    ...issue.details.map((d) => `  ${c.dim}${d}${c.reset}`),
  ];
  if (issue.suggestedFix !== undefined) {
    lines.push(
      `  ${c.bold}${c.green}Suggested fix:${c.reset} ${issue.suggestedFix}`,
    );
  }
  if (issue.docUrl !== undefined) {
    lines.push(`  ${c.dim}→ docs: ${c.underline}${issue.docUrl}${c.reset}`);
  }
  return lines.join("\n");
};

/** Every issue, one block each, in the order the checks produced them. No summary line. */
export const formatValidationIssuesText = (
  issues: readonly ValidationIssue[],
  options?: FormatValidationTextOptions,
): string => {
  const c = resolveAnsi(options?.color);
  return issues
    .map((issue) => formatIssueText(withDocUrl(issue), c))
    .join("\n\n");
};

export const formatValidationReportText = (
  report: ValidationReport,
  options?: FormatValidationTextOptions,
): string => {
  const c = resolveAnsi(options?.color);

  if (report.issues.length === 0) {
    return `${c.green}Validation passed: no issues found.${c.reset}`;
  }

  const body = formatValidationIssuesText(report.issues, options);
  const summary =
    report.errorCount > 0
      ? `${c.bold}${c.red}Validation failed:${c.reset} ${report.errorCount} error${report.errorCount === 1 ? "" : "s"}, ${report.warningCount} warning${report.warningCount === 1 ? "" : "s"}.`
      : `${c.bold}${c.green}Validation passed${c.reset} with ${report.warningCount} warning${report.warningCount === 1 ? "" : "s"}.`;

  return `${body}\n\n${summary}`;
};

/**
 * Stable JSON schema for `--json` (public CLI API).
 *
 * Carries `docUrl` alongside the fields it always had — added, never renamed — and carries no
 * colour: escapes are a terminal concern and would corrupt a machine-read field.
 */
export const formatValidationReportJson = (
  report: ValidationReport,
): string => JSON.stringify(report.issues.map(withDocUrl), null, 2);
