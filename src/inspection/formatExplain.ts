/**
 * @fileoverview Rendering for `ioc explain <key>` — one screen, four questions, in order.
 *
 * The order is the contract of the command: **what it is**, **how long it lives and who decided
 * that**, **what it depends on**, **who depends on it**. A reader who only needs the first answer
 * stops after two lines; a reader chasing a captive-dependency bug reads to the end.
 *
 * `--json` carries the same record with none of the colour and none of the layout — the same
 * complete-record rule the inspection reports keep.
 */
import { resolveAnsi, type Ansi } from "../diagnostics/ansi.js";
import { docsUrlForCode } from "../diagnostics/errorDocs.js";
import { LIFETIME_INVERSION_CODE } from "../generator/validateLifetimeInversionsAtCodegen.js";
import type { ExplainDependency, ExplainReport } from "./explain.js";

export type FormatExplainOptions = {
  /** When omitted, uses TTY + NO_COLOR / FORCE_COLOR (same idea as common CLIs). */
  color?: boolean;
};

const formatResolution = (report: ExplainReport, c: Ansi): string[] => {
  const r = report.resolution;
  const head = `${c.bold}${c.cyan}${report.key}${c.reset}`;

  if (r.kind === "registration") {
    return [
      `${head} ${c.dim}→${c.reset} registration of ${c.bold}${r.unit.contractName}${c.reset}` +
        ` ${c.dim}(${r.unit.implementationName})${c.reset}` +
        `${r.unit.isDefault ? `  ${c.green}★ backs the contract slot${c.reset}` : ""}`,
      `  ${c.dim}declared in${c.reset} ${r.unit.modulePath}#${r.unit.exportName}`,
    ];
  }

  if (r.kind === "contract-slot") {
    return [
      `${head} ${c.dim}→${c.reset} contract slot for ${c.bold}${r.contractName}${c.reset}` +
        ` ${c.dim}— resolves whichever implementation is elected${c.reset}`,
      r.electee !== undefined
        ? `  ${c.green}★${c.reset} elected: ${r.electee.registrationKey}` +
          ` ${c.dim}(${r.electee.modulePath}#${r.electee.exportName})${c.reset}` +
          (r.implementations.length > 1
            ? ` ${c.dim}of ${r.implementations.length}: ${r.implementations.join(", ")}${c.reset}`
            : "")
        : `  ${c.red}✖${c.reset} no implementation is elected — see \`ioc inspect\``,
    ];
  }

  if (r.kind === "group") {
    return [
      `${head} ${c.dim}→${c.reset} ${r.groupKind} group of ${c.bold}${r.baseType}${c.reset}` +
        ` ${c.dim}(${r.members.length} member(s))${c.reset}`,
      ...r.members.map(
        (m) => `  ${m.memberName} ${c.dim}—${c.reset} ${m.registrationKey}`,
      ),
    ];
  }

  if (r.kind === "opener") {
    return [
      `${head} ${c.dim}→${c.reset} scope-root opener for ${c.bold}${r.contractName}${c.reset}` +
        ` ${c.dim}variant:${c.reset} ${r.variantName}`,
      `  ${c.dim}late-bound values:${c.reset} ${r.lbvKeys.length > 0 ? r.lbvKeys.join(", ") : "—"}`,
    ];
  }

  return [
    `${head} ${c.red}is not a key this package registers.${c.reset}`,
    ...(r.similarKeys.length > 0
      ? [`  ${c.dim}similar keys:${c.reset} ${r.similarKeys.join(", ")}`]
      : [
          `  ${c.dim}no similar key either — check the spelling, or the key may be an external the composing app supplies.${c.reset}`,
        ]),
  ];
};

/**
 * The provenance chain, rendered as the arrows a reader can follow backwards.
 *
 * `scoped ← group-base marker on WriteServiceBase ← member of group "writeServices"` reads in the
 * direction of causation, ending at the file to open.
 */
const formatLifetime = (report: ExplainReport, c: Ansi): string[] => {
  if (report.lifetime === undefined) {
    return [];
  }
  const { lifetime, provenance } = report.lifetime;
  const chain =
    provenance.length > 0
      ? provenance.map((step) => ` ${c.dim}←${c.reset} ${step}`).join("")
      : ` ${c.dim}← provenance not recorded in the manifest${c.reset}`;
  return ["", `${c.bold}Lifetime:${c.reset} ${lifetime}${chain}`];
};

const formatDependency = (dep: ExplainDependency, c: Ansi): string[] => {
  const lifetime =
    dep.lifetime !== undefined ? `  ${dep.lifetime}` : `  ${c.dim}—${c.reset}`;
  const lines = [
    `  ${c.bold}${dep.key}${c.reset}${lifetime}  ${c.dim}${dep.resolvedAs}${c.reset}`,
  ];
  if (dep.pressure !== undefined) {
    const tint = dep.pressure.severity === "error" ? c.red : c.yellow;
    lines.push(
      `      ${tint}![${LIFETIME_INVERSION_CODE}]${c.reset} ${dep.pressure.message}`,
    );
  }
  return lines;
};

const formatDependencies = (report: ExplainReport, c: Ansi): string[] => {
  if (report.dependencies.length === 0) {
    return [];
  }
  const docs = report.dependencies.some((d) => d.pressure !== undefined)
    ? docsUrlForCode(LIFETIME_INVERSION_CODE)
    : undefined;
  return [
    "",
    `${c.bold}Depends on:${c.reset}`,
    ...report.dependencies.flatMap((dep) => formatDependency(dep, c)),
    ...(docs !== undefined ? [`      ${c.dim}→ docs: ${docs}${c.reset}`] : []),
  ];
};

const formatDependents = (report: ExplainReport, c: Ansi): string[] => {
  if (report.dependents.length === 0) {
    // For a key that resolves to nothing, "demanded by nothing" is not a second finding — it is the
    // same one restated. The section only earns its line when there is something to say.
    return report.resolution.kind === "unknown"
      ? []
      : [
          "",
          `${c.bold}Demanded by:${c.reset} ${c.dim}nothing in this package${c.reset}`,
        ];
  }
  return [
    "",
    `${c.bold}Demanded by:${c.reset}`,
    ...report.dependents.map(
      (d) =>
        `  ${d.demander} ${c.dim}(${d.modulePath})${c.reset}` +
        (d.via === "direct" ? "" : `  ${c.dim}via ${d.via}${c.reset}`),
    ),
  ];
};

const formatSubtrees = (report: ExplainReport, c: Ansi): string[] => {
  if (report.scopeRootSubtrees.length === 0) {
    return [];
  }
  return [
    "",
    `${c.bold}Reached from scope roots:${c.reset}`,
    ...report.scopeRootSubtrees.map(
      (s) =>
        `  ${c.cyan}⬢${c.reset} ${s.contractName} ${c.dim}variant:${c.reset} ${s.variantName}` +
        `  ${c.dim}opener:${c.reset} ${s.openerKey}`,
    ),
  ];
};

export const formatExplainReport = (
  report: ExplainReport,
  options?: FormatExplainOptions,
): string => {
  const c = resolveAnsi(options?.color);
  return [
    ...formatResolution(report, c),
    ...formatLifetime(report, c),
    ...formatDependencies(report, c),
    ...formatDependents(report, c),
    ...formatSubtrees(report, c),
    ...(report.notes.length > 0
      ? ["", ...report.notes.map((note) => `${c.dim}${note}${c.reset}`)]
      : []),
  ]
    .join("\n")
    .trimEnd();
};

/** `ioc explain <key> --json`. Same record, no colour, no layout. */
export const formatExplainReportJson = (report: ExplainReport): string =>
  JSON.stringify({ kind: "explain", ...report }, null, 2);
