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
import { groupKeyToTypeAliasName } from "../generator/naming.js";
import { LIFETIME_INVERSION_CODE } from "../generator/validateLifetimeInversionsAtCodegen.js";
import type { ExplainDependency, ExplainReport } from "./explain.js";

export type FormatExplainOptions = {
  /** When omitted, uses TTY + NO_COLOR / FORCE_COLOR (same idea as common CLIs). */
  color?: boolean;
};

/**
 * The group law, stated as an ANSWER.
 *
 * The same facts the `grouped-member-demand` error carries, in the teaching register: what the key
 * names, which group owns it, why it has no cradle key of its own, and the spelling that does work.
 * A reader who typed this key is not making a mistake the tool has to refuse — they are asking a
 * reasonable question whose answer happens to be a rule, and the error path is untouched.
 */
const formatGroupedMember = (
  key: string,
  r: Extract<ExplainReport["resolution"], { kind: "grouped-member" }>,
  c: Ansi,
): string[] => {
  const head = `${c.bold}${c.cyan}${key}${c.reset}`;
  const alias = groupKeyToTypeAliasName(r.groupKey);
  const groupPhrase = r.declaredByComposedPackage
    ? `composed group ${JSON.stringify(r.groupKey)}`
    : `group ${JSON.stringify(r.groupKey)}`;
  const docs = docsUrlForCode("grouped-member-demand");

  // The record's OWN property key, never the member's registration key: `registerGroups` builds the
  // group value from these keys, so the two diverge whenever an implementation is named differently
  // from its contract — and the divergent case is exactly the one a reader gets wrong unaided.
  const consume =
    r.groupKind === "object" && r.recordPropertyKey !== undefined
      ? `  Consume it through the group: \`${r.groupKey}: ${alias}\`, then \`${r.groupKey}.${r.recordPropertyKey}\`.`
      : `  Consume it through the group: \`${r.groupKey}: ${alias}\` — a collection group's members are individually anonymous by declaration, so ${JSON.stringify(key)} names nothing.`;

  return [
    `${head} ${c.dim}→${c.reset} member of ${c.bold}${groupPhrase}${c.reset}` +
      ` ${c.dim}— no individual cradle key${c.reset}`,
    `  ${c.dim}group:${c.reset}     ${JSON.stringify(r.groupKey)}  ${c.dim}(kind: ${r.groupKind}, base: ${r.baseType}, declared by ${r.declaredBy})${c.reset}`,
    ...(r.contractName !== undefined
      ? [`  ${c.dim}contract:${c.reset}  ${JSON.stringify(r.contractName)}`]
      : [`  ${c.dim}base:${c.reset}      ${JSON.stringify(r.baseType)}`]),
    `  ${c.dim}A grouped contract is consumed through its group and through nothing else — it has no contract key and its implementations claim no individual cradle keys.${c.reset}`,
    consume,
    ...(docs !== undefined ? [`  ${c.dim}→ docs: ${docs}${c.reset}`] : []),
  ];
};

/**
 * Which package supplies the key, printed once under the resolution.
 *
 * Only over a composed picture. In a library there is one package, and naming it on every answer
 * would be a line of noise on every screen — which is also what keeps a purely local explanation
 * identical to what it has always printed.
 */
const formatSupplier = (report: ExplainReport, c: Ansi): string[] =>
  report.supplier === undefined
    ? []
    : [`  ${c.dim}supplied by${c.reset} ${report.supplier.packageLabel}`];

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
        ` ${c.dim}(${r.members.length} member(s))${c.reset}` +
        (r.declaredBy !== undefined
          ? `  ${c.dim}declared by ${r.declaredBy}${c.reset}`
          : ""),
      // Members are attributed one by one rather than to the root: a composed root MERGES across
      // manifests, so "who declares this group" and "who supplies this member" are different
      // questions and a reader chasing one member needs the second one answered.
      ...r.members.map(
        (m) =>
          `  ${m.memberName} ${c.dim}—${c.reset} ${m.registrationKey}` +
          (m.packageLabel !== undefined
            ? `  ${c.dim}from ${m.packageLabel}${c.reset}`
            : ""),
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

  if (r.kind === "grouped-member") {
    return formatGroupedMember(report.key, r, c);
  }

  if (r.kind === "external") {
    return [
      `${head} ${c.dim}→${c.reset} ${c.bold}external${c.reset}` +
        ` ${c.dim}— supplied by the composing app at bootstrap${c.reset}`,
      ...(r.typeText !== undefined
        ? [`  ${c.dim}demanded:${c.reset}    ${r.typeText}`]
        : []),
      `  ${c.dim}demanded by:${c.reset} ${r.demandedBy
        .map((d) => d.packageLabel)
        .join(", ")}`,
      `  ${c.dim}Nothing in the composed manifests registers it — the app registers it on the root container before composing.${c.reset}`,
    ];
  }

  // The scope of the miss is the scope of the search. In an app the composed manifests were read
  // too, and the "it may be an external the composing app supplies" hint has already been tried —
  // a declared external resolves above, so reaching here means nothing declares it either.
  return [
    `${head} ${c.red}is not a key ${
      report.composed === true ? "this composition" : "this package"
    } registers.${c.reset}`,
    ...(r.similarKeys.length > 0
      ? [`  ${c.dim}similar keys:${c.reset} ${r.similarKeys.join(", ")}`]
      : report.composed === true
        ? [
            `  ${c.dim}no similar key in this app or any composed manifest — check the spelling, or the key may be one the app registers on the container without declaring it.${c.reset}`,
          ]
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
  const { lifetime, provenance, degradedNote } = report.lifetime;
  const chain =
    provenance.length > 0
      ? provenance.map((step) => ` ${c.dim}←${c.reset} ${step}`).join("")
      : // The degraded case names the remedy when there is one — a supplier whose manifest predates
        // the field — and otherwise keeps the words a manifest-mode reader has always seen.
        degradedNote !== undefined
        ? ` ${c.dim}← ${degradedNote}${c.reset}`
        : ` ${c.dim}← provenance not recorded in the manifest${c.reset}`;
  return ["", `${c.bold}Lifetime:${c.reset} ${lifetime}${chain}`];
};

const formatDependency = (dep: ExplainDependency, c: Ansi): string[] => {
  const lifetime =
    dep.lifetime !== undefined ? `  ${dep.lifetime}` : `  ${c.dim}—${c.reset}`;
  const lines = [
    `  ${c.bold}${dep.key}${c.reset}${lifetime}  ${c.dim}${dep.resolvedAs}${c.reset}` +
      (dep.packageLabel !== undefined
        ? `  ${c.dim}from ${dep.packageLabel}${c.reset}`
        : ""),
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
          `${c.bold}Demanded by:${c.reset} ${c.dim}nothing in ${
            report.composed === true ? "the composed picture" : "this package"
          }${c.reset}`,
        ];
  }
  return [
    "",
    `${c.bold}Demanded by:${c.reset}`,
    ...report.dependents.map(
      (d) =>
        `  ${d.demander} ${c.dim}(${d.modulePath})${c.reset}` +
        (d.via === "direct" ? "" : `  ${c.dim}via ${d.via}${c.reset}`) +
        (d.packageLabel !== undefined
          ? `  ${c.dim}in ${d.packageLabel}${c.reset}`
          : ""),
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
    ...formatSupplier(report, c),
    ...formatLifetime(report, c),
    ...formatDependencies(report, c),
    ...formatDependents(report, c),
    ...formatSubtrees(report, c),
    // The staleness caveat sits with the answer, not only in the banner above it — the same ruling
    // the composition suite reached about per-finding caveats, for the same reader who scrolled
    // past the banner to get to the thing they asked about.
    ...(report.stalenessNote !== undefined
      ? ["", `${c.yellow}${report.stalenessNote}${c.reset}`]
      : []),
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
