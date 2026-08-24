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
import type { IocGenerationStateMarker } from "../diagnostics/generationState.js";
import {
  toFreshnessJson,
  type PackageFreshness,
} from "../diagnostics/freshness.js";
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
    // Immediately under the claim, ahead of the mechanism. A caveat printed at the bottom of a
    // block is read after the reader has already decided what the finding means; this one has to
    // land while they are still deciding.
    ...(issue.stalenessNote !== undefined
      ? [`  ${c.yellow}${issue.stalenessNote}${c.reset}`]
      : []),
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

export type FormatValidationJsonOptions = {
  /** The staleness marker, when the last generation attempt in this package failed. */
  readonly staleness?: IocGenerationStateMarker;
  /**
   * One entry per package judged for freshness, in slice order (local first).
   *
   * BESIDE `staleness`, not folded into it: they answer different questions and a consumer gating
   * on one must not be silently handed the other. `staleness` is "the last attempt in THIS package
   * refused to write"; `freshness` is "these packages' artifacts may predate their sources".
   */
  readonly freshness?: readonly PackageFreshness[];
};

/**
 * The public projection of one issue.
 *
 * Explicit rather than "serialize whatever the object has": the issue type now carries fields that
 * are machinery — `packages` is attribution the freshness pass matches on, `stalenessNote` is the
 * rendered prose the text output prints — and neither is a promise this document should be making.
 * What ships is the documented field set plus `possiblyStale`, which is the machine-readable half
 * of the caveat.
 */
const toIssueJson = (issue: ValidationIssue): Record<string, unknown> => ({
  category: issue.category,
  severity: issue.severity,
  summary: issue.summary,
  details: issue.details,
  ...(issue.suggestedFix !== undefined
    ? { suggestedFix: issue.suggestedFix }
    : {}),
  ...(issue.docUrl !== undefined ? { docUrl: issue.docUrl } : {}),
  ...(issue.possiblyStale === true ? { possiblyStale: true } : {}),
});

/**
 * Stable JSON schema for `--json` (public CLI API).
 *
 * Carries `docUrl` alongside the fields it always had — added, never renamed — and carries no
 * colour: escapes are a terminal concern and would corrupt a machine-read field.
 *
 * ### The document is an OBJECT (4.0 break)
 *
 * Through 3.x this was the bare issue array. It is now `{ issues }`, with an optional `staleness`
 * beside it when the package's last generation attempt failed.
 *
 * The alternative was to keep the array and wrap it only when a marker is present. That is a
 * smaller diff and a worse contract: a document whose ROOT TYPE depends on workspace state forces
 * every consumer to branch on `Array.isArray` before it can read anything, and the branch that
 * carries the extra field is the rare one — so it is the branch nobody tests and everybody's
 * pipeline discovers in production, on the day something is already wrong. A stable root that
 * consumers adapt to once, in a major, is the cheaper cost.
 *
 * Per-issue field names are untouched: `category`, `severity`, `summary`, `details`,
 * `suggestedFix`, `docUrl` — plus `possiblyStale: true` on a finding whose packages may have
 * artifacts that predate their sources. Only the envelope moved, and it moved once.
 *
 * The envelope now carries `freshness` beside `staleness`: an array, one entry per package judged,
 * `{ name, outcome, generatedAt, currentMatches }`. Added beside, never renamed — a consumer
 * reading `staleness` and `issues` sees exactly what it saw before.
 */
export const formatValidationReportJson = (
  report: ValidationReport,
  options?: FormatValidationJsonOptions,
): string =>
  JSON.stringify(
    {
      // Omitted rather than nulled when generation last succeeded, matching how `inspect --json`
      // and `explain --json` carry the same field — one absence rule across all three verbs.
      ...(options?.staleness !== undefined
        ? { staleness: options.staleness }
        : {}),
      // Omitted when nothing was judged, on the same absence rule as `staleness`. An empty array
      // would read as "every package was checked and all are current", which is a claim.
      ...(options?.freshness !== undefined && options.freshness.length > 0
        ? { freshness: toFreshnessJson(options.freshness) }
        : {}),
      issues: report.issues.map((issue) => toIssueJson(withDocUrl(issue))),
    },
    null,
    2,
  );
