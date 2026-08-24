/**
 * @fileoverview `[registry-integrity]` — refuses to reason over a generated file that does not compile.
 *
 * Validate's type comparisons run against a `ts.Program` built over the generated registry-types
 * files. Until this check existed, nothing read that program's diagnostics: a name the generated
 * file failed to resolve became an ERROR type, and TypeScript treats an error type as assignable
 * in both directions — so `ioc validate` reported "no issues found" on a build that could not
 * compile. That is the read-side twin of the emission defect the import-closure invariant closed
 * on the write side, and it is worse in one respect: emission failed loudly once, whereas this
 * failed quietly on every run.
 *
 * So the gate comes first. If a registry file does not hold together, the comparisons that read
 * types out of it are not run at all — not run and reported satisfied, not run and reported
 * unsatisfied, but skipped and said to be skipped.
 */
import path from "node:path";
import type ts from "typescript";
import {
  collectRegistryFileDiagnostics,
  formatRegistryDiagnostic,
} from "../typeComparison.js";
import type { CompositionProgramContext } from "../compositionProgram.js";
import { isLocalSlice, sliceLabel } from "../sliceLabel.js";
import type { ParsedManifestSlice, CompositionContext, ValidationIssue } from "../types.js";

/**
 * How many diagnostics ride along per broken file.
 *
 * Five: enough that the cause is usually visible in the first issue (the closure-breaking shapes
 * this catches tend to produce a small cluster — one `TS2305` per unexported name, one `TS2304`
 * per unbound name), few enough that a badly broken file does not bury the rest of the report.
 * The remainder is counted, never silently dropped.
 */
export const REGISTRY_INTEGRITY_MAX_DIAGNOSTICS = 5;

export type RegistryIntegrityResult = {
  readonly issues: readonly ValidationIssue[];
  /**
   * Types files that do not compile. A comparison is skipped when EITHER side reads from one:
   * the demanding slice's file, or any supplying slice's file.
   */
  readonly brokenTypesPaths: ReadonlySet<string>;
};

export const EMPTY_REGISTRY_INTEGRITY: RegistryIntegrityResult = {
  issues: [],
  brokenTypesPaths: new Set(),
};

const displayPath = (projectRoot: string, filePath: string): string => {
  const rel = path.relative(projectRoot, filePath);
  return rel.length > 0 && !rel.startsWith("..") ? rel : filePath;
};

/**
 * Two causes, and the user can tell them apart by acting on the first.
 *
 * Stale output is by far the likelier and is cheap to rule out — regenerate and look again. An
 * error that survives regeneration is an emission bug, which is ours, not theirs. For a COMPOSED
 * package the consumer cannot regenerate it themselves at all, so the action is different in kind
 * and the message says so rather than sending them to a command that cannot help.
 */
const suggestedFixFor = (slice: ParsedManifestSlice): string =>
  isLocalSlice(slice)
    ? "Re-run `ioc generate` for this package — generated output that predates a source change is " +
      "the usual cause. If the same errors survive regeneration, the file was emitted broken: " +
      "that is a bug in ioc-manifest, please report it with this output."
    : `Regenerate and republish ${sliceLabel(slice)} with a current ioc-manifest — its committed ` +
      "manifest is stale or was emitted broken. Until then this package's types cannot be " +
      "compared against. If the errors survive regeneration there, report it as an ioc-manifest bug.";

const buildBrokenFileIssue = (
  projectRoot: string,
  slice: ParsedManifestSlice,
  diagnostics: readonly ts.Diagnostic[],
): ValidationIssue => {
  const shown = diagnostics.slice(0, REGISTRY_INTEGRITY_MAX_DIAGNOSTICS);
  const suppressed = diagnostics.length - shown.length;

  const details = [
    `file:  ${displayPath(projectRoot, slice.typesPath)}`,
    ...shown.map((d) => formatRegistryDiagnostic(d)),
  ];
  if (suppressed > 0) {
    details.push(
      `(${suppressed} further error${suppressed === 1 ? "" : "s"} in this file not shown)`,
    );
  }
  details.push(
    "Type comparisons that read from this file are SKIPPED — an unresolvable name becomes an " +
      "error type, and comparisons against an error type pass regardless of what they are asked.",
  );

  return {
    packages: [slice.sourceId],
    category: "registry-integrity",
    severity: "error",
    summary: `Generated types for ${sliceLabel(slice)} do not compile (${diagnostics.length} error${diagnostics.length === 1 ? "" : "s"})`,
    details,
    suggestedFix: suggestedFixFor(slice),
  };
};

/** One key's comparison, and which file's breakage tainted it. */
export type SkippedComparison = {
  readonly externalKey: string;
  readonly demandedBy: string;
  readonly taintedByPaths: readonly string[];
  /** Machine tokens for the demanding and supplying packages — the same set the verdict read. */
  readonly packages: readonly string[];
};

/**
 * One aggregate notice for every comparison the gate withheld.
 *
 * A warning rather than an error: the ERROR is the broken file, reported once above. This exists
 * so the report never reads as coverage it did not have — a run that both fails on integrity and
 * silently drops half its comparisons would be its own kind of quiet.
 *
 * Summaries here carry no `[registry-integrity]` prefix: the report formatter prepends the
 * category, and every check but `externals` leaves it to do so.
 */
export const buildSkippedComparisonsIssue = (
  projectRoot: string,
  skipped: readonly SkippedComparison[],
): ValidationIssue | undefined => {
  if (skipped.length === 0) {
    return undefined;
  }
  return {
    category: "registry-integrity",
    severity: "warning",
    summary: `Skipped ${skipped.length} externals type comparison${skipped.length === 1 ? "" : "s"} that read from a file that does not compile`,
    details: skipped.map(
      ({ externalKey, demandedBy, taintedByPaths }) =>
        `${JSON.stringify(externalKey)} (demanded by ${demandedBy}) — tainted by ${taintedByPaths
          .map((p) => displayPath(projectRoot, p))
          .join(", ")}`,
    ),
    suggestedFix:
      "Fix the reported [registry-integrity] errors, then re-run validate to get a verdict on these keys.",
    packages: [...new Set(skipped.flatMap((s) => s.packages))],
  };
};

/**
 * Diagnostics for the registry-types files validate reads, one issue per offending file.
 *
 * Returns no issues when no checker is available: an absent checker is not evidence of breakage,
 * and the externals check already carries its own caveat for that case.
 */
export const checkRegistryIntegrity = (
  compositionCtx: CompositionContext,
  typeCheckerCtx: CompositionProgramContext | undefined,
): RegistryIntegrityResult => {
  if (typeCheckerCtx === undefined) {
    return EMPTY_REGISTRY_INTEGRITY;
  }

  const diagnosticsByPath = collectRegistryFileDiagnostics(
    typeCheckerCtx,
    compositionCtx.slices.map((slice) => slice.typesPath),
  );
  if (diagnosticsByPath.size === 0) {
    return EMPTY_REGISTRY_INTEGRITY;
  }

  const issues: ValidationIssue[] = [];
  const brokenTypesPaths = new Set<string>();

  // Slice order, so the report is stable and reads local-first like every other check.
  for (const slice of compositionCtx.slices) {
    const diagnostics = diagnosticsByPath.get(slice.typesPath);
    if (diagnostics === undefined || brokenTypesPaths.has(slice.typesPath)) {
      continue;
    }
    brokenTypesPaths.add(slice.typesPath);
    issues.push(
      buildBrokenFileIssue(compositionCtx.projectRoot, slice, diagnostics),
    );
  }

  return { issues, brokenTypesPaths };
};
