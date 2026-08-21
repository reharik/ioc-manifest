/**
 * @fileoverview Plain-text rendering of inspection/discovery reports for terminal output (`ioc` CLI).
 *
 * Row shape is **one line per unit**. A near-miss adds one indented gloss line; an unsatisfied
 * scope root adds one indented line per unmet demand. Nothing else wraps: the previous
 * label-per-line shape turned a 40-unit scan into 200 lines nobody read.
 *
 * Skip-reason and rejection codes are printed verbatim in snake_case — they are the grep handle for
 * humans and agents alike, so they are never prettified.
 */
import type { ScopeRootSharedSubtreeUnit } from "../generator/scopeRootExternalsExclusion.js";
import type {
  DiscoveryExportReportRow,
  DiscoveryReport,
  DiscoveryScopeRootVerificationRow,
  InspectionGroupReport,
  InspectionOpenerReport,
  InspectionReport,
} from "./reports.js";
import type { ManifestValidationIssue } from "./validateManifest.js";

const shouldColorize = (): boolean => {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") {
    return false;
  }
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") {
    return true;
  }
  return process.stdout.isTTY === true;
};

type Ansi = {
  reset: string;
  bold: string;
  dim: string;
  cyan: string;
  green: string;
  red: string;
  yellow: string;
};

const ansi = (enabled: boolean): Ansi => {
  if (!enabled) {
    const id = (s: string): string => s;
    return {
      reset: id(""),
      bold: id(""),
      dim: id(""),
      cyan: id(""),
      green: id(""),
      red: id(""),
      yellow: id(""),
    };
  }
  return {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
  };
};

/**
 * Names are padded to a shared column within a file block so the eye can scan down the contract
 * column. Capped: one 60-character export name must not push every other row off an 80-column
 * terminal, so a long name overflows its own row instead of widening the block.
 */
const NAME_COLUMN_CAP = 28;

const pad = (text: string, width: number): string =>
  text.length >= width ? text : text + " ".repeat(width - text.length);

const formatManifestIssues = (
  issues: readonly ManifestValidationIssue[],
): string => {
  if (issues.length === 0) return "";

  return [
    "Manifest validation:",
    ...issues.map((i) => `  - [${i.code}] ${i.message}`),
    "",
  ].join("\n");
};

const formatGroupsSection = (
  groups: readonly InspectionGroupReport[],
  c: Ansi,
): string[] => {
  if (groups.length === 0) return [];

  const lines: string[] = [`${c.bold}Groups:${c.reset}`];

  for (const group of groups) {
    const arg =
      group.baseTypeArg !== undefined ? `<${group.baseTypeArg}>` : "";
    lines.push(
      `  ${c.bold}${group.groupName}${c.reset} ${c.dim}${group.kind} of${c.reset} ${group.baseType}${arg}`,
    );

    if (group.members.length === 0) {
      lines.push(`    ${c.yellow}(no members)${c.reset}`);
    }
    for (const member of group.members) {
      lines.push(
        `    ${member.memberName} ${c.dim}—${c.reset} ${member.registrationKey}`,
      );
    }

    if (group.rejectionsUnavailable === true) {
      lines.push(
        `    ${c.dim}(rejected candidates are recorded at generation — run \`ioc inspect --discovery\`)${c.reset}`,
      );
      continue;
    }

    for (const rejection of group.rejections) {
      const name =
        rejection.registrationKey !== undefined
          ? `${rejection.contractName}.${rejection.registrationKey}`
          : rejection.contractName;
      lines.push(
        `    ${c.dim}considered, rejected:${c.reset} ${name} ${c.yellow}(${rejection.reason})${c.reset} ${c.dim}— ${rejection.gloss}${c.reset}`,
      );
    }
  }

  lines.push("");
  return lines;
};

/**
 * Emitted scope-root openers, one line each.
 *
 * Its own section rather than a contract row, because a scope-rooted contract has no contract row
 * to belong to: it claims no cradle key and elects no default. The opener key is the only key it
 * puts in the cradle, so this is where the reader looks for it.
 */
const formatOpenersSection = (
  openers: readonly InspectionOpenerReport[],
  c: Ansi,
): string[] => {
  if (openers.length === 0) return [];

  const lines: string[] = [`${c.bold}Openers:${c.reset}`];
  const keyWidth = Math.min(
    NAME_COLUMN_CAP,
    Math.max(0, ...openers.map((o) => o.openerKey.length)),
  );

  for (const opener of openers) {
    lines.push(
      `  ${c.cyan}⬢${c.reset} ${c.bold}${pad(opener.openerKey, keyWidth)}${c.reset}` +
        ` ${c.dim}→${c.reset} ${opener.contractName}` +
        `  ${c.dim}variant:${c.reset} ${opener.variantName}` +
        `  ${c.dim}lbv:${c.reset} ${opener.lbvKeys.length > 0 ? opener.lbvKeys.join(", ") : "—"}`,
    );
  }

  lines.push("");
  return lines;
};

export type FormatInspectionReportOptions = {
  /** When omitted, uses TTY + NO_COLOR / FORCE_COLOR (same idea as common CLIs). */
  color?: boolean;
};

export const formatInspectionReport = (
  report: InspectionReport,
  options?: FormatInspectionReportOptions,
): string => {
  const color =
    options?.color !== undefined ? options.color : shouldColorize();
  const c = ansi(color);
  const lines: string[] = [];

  const header = formatManifestIssues(report.manifestIssues);
  if (header.length > 0) {
    lines.push(header.trimEnd());
    lines.push("");
  }

  for (const contract of report.contracts) {
    lines.push(`${c.bold}${c.cyan}${contract.contractName}${c.reset}`);

    if (contract.defaultImplementationName === undefined) {
      lines.push(
        `  ${c.yellow}default: (unresolved — see manifest validation)${c.reset}`,
      );
    }

    const nameWidth = Math.min(
      NAME_COLUMN_CAP,
      Math.max(
        0,
        ...contract.implementations.map((i) => i.implementationName.length),
      ),
    );

    for (const impl of contract.implementations) {
      const marker = impl.isDefault ? `${c.green}★${c.reset}` : " ";
      lines.push(
        `  ${marker} ${c.bold}${pad(impl.implementationName, nameWidth)}${c.reset}` +
          `  ${c.dim}key:${c.reset} ${impl.registrationKey}` +
          `  ${impl.lifecycle}` +
          `  ${c.dim}${impl.modulePath}#${impl.exportName}${c.reset}`,
      );
    }

    lines.push("");
  }

  lines.push(...formatOpenersSection(report.openers, c));
  lines.push(...formatGroupsSection(report.groups, c));

  if (report.filter !== undefined) {
    lines.push(
      `${c.dim}Showing ${report.contracts.length} of ${report.totalContractCount} contract(s) matching --contract ${JSON.stringify(report.filter.contract)}.${c.reset}`,
    );
  }

  return lines.join("\n").trimEnd();
};

export type FormatDiscoveryReportOptions = {
  /** When omitted, uses TTY + NO_COLOR / FORCE_COLOR (same idea as common CLIs). */
  color?: boolean;
  /** Show not-a-candidate rows (and the files that hold only those). Default: hidden. */
  verbose?: boolean;
};

const isVisibleRow = (
  row: DiscoveryExportReportRow,
  verbose: boolean,
): boolean => verbose || row.status === "discovered" || row.partition === "near_miss";

const formatScopeRootDetail = (
  verification: DiscoveryScopeRootVerificationRow,
  c: Ansi,
): string[] => {
  const lines: string[] = [];

  // A satisfied variant says so on its row and stops there. An unsatisfied one lists every
  // scope-demand, not only the failing ones: the reader needs the whole boundary to see what the
  // declaration is missing relative to what it already covers.
  if (!verification.satisfied) {
    for (const demand of verification.scopeDemands) {
      const marker =
        demand.satisfiedBy === "declared-lbv"
          ? `${c.green}✔${c.reset}`
          : `${c.red}✖${c.reset}`;
      const detail =
        demand.satisfiedBy === "undeclared"
          ? " not declared"
          : demand.satisfiedBy === "type-mismatch"
            ? ` declared ${demand.suppliedTypeText} is not assignable to demanded ${demand.demandedTypeText}`
            : "";
      lines.push(
        `      ${marker} ${demand.key}${detail} ${c.dim}(${demand.via})${c.reset}`,
      );
    }
  }

  // Container-supplied, not a scope-demand: this layer cannot expand the group, generation can.
  // Rendering it as unsatisfied would claim a failure that generation does not have.
  for (const resolved of verification.generationResolvedKeys) {
    lines.push(
      `      ${c.dim}· ${resolved.key} container-supplied — resolved at generation (${resolved.via} key) (${resolved.path})${c.reset}`,
    );
  }

  for (const key of verification.unusedDeclaredKeys) {
    lines.push(
      `      ${c.yellow}!${c.reset} ${key} ${c.dim}declared but never demanded${c.reset}`,
    );
  }

  // The stated blind spot. Printed last and unconditionally — including under a ✔ — because that is
  // the row it changes the meaning of: a satisfied verdict over a subtree that was only partly
  // walked is exactly the false confidence this line exists to qualify.
  if (verification.blindComposedPackages.length > 0) {
    lines.push(
      `      ${c.yellow}!${c.reset} ${c.dim}subtree reaches composed ${verification.blindComposedPackages.join(", ")} — no dependency data in their manifests, lbv verification incomplete for that subtree${c.reset}`,
    );
  }

  return lines;
};

const formatRow = (
  row: DiscoveryExportReportRow,
  nameWidth: number,
  c: Ansi,
): string[] => {
  // A whole-file skip has no export to name; say so rather than printing a bare status word.
  const name = row.exportName ?? "(whole file)";

  if (row.isScopeRoot === true) {
    const keys =
      row.declaredLbvKeys !== undefined && row.declaredLbvKeys.length > 0
        ? row.declaredLbvKeys.join(", ")
        : (row.declaredLbv ?? "—");
    const verification = row.scopeRootVerification;
    const verdict =
      verification === undefined
        ? `${c.dim}unverified${c.reset}`
        : verification.satisfied
          ? `${c.green}✔ satisfied${c.reset}`
          : `${c.red}✖ unsatisfied${c.reset}`;
    const opener =
      row.openerKey !== undefined
        ? `  ${c.dim}opener:${c.reset} ${row.openerKey}`
        : "";
    return [
      `  ${c.cyan}⬢${c.reset} ${c.bold}${pad(name, nameWidth)}${c.reset} ${c.dim}→${c.reset} ${row.contractName} ${c.cyan}[scope root]${c.reset}` +
        `${opener}  ${c.dim}lbv:${c.reset} ${keys}  ${verdict}`,
      ...(verification !== undefined
        ? formatScopeRootDetail(verification, c)
        : []),
    ];
  }

  if (row.status === "discovered") {
    const lifetime =
      row.lifetime !== undefined
        ? `  ${row.lifetime}${row.lifetimeSource !== undefined ? ` ${c.dim}(${row.lifetimeSource})${c.reset}` : ""}`
        : "";
    return [
      `  ${c.green}✔${c.reset} ${c.bold}${pad(name, nameWidth)}${c.reset} ${c.dim}→${c.reset} ${row.contractName}` +
        `  ${c.dim}key:${c.reset} ${row.registrationKey}${lifetime}`,
    ];
  }

  const contract =
    row.contractName !== undefined
      ? ` ${c.dim}→${c.reset} ${row.contractName}`
      : "";
  const extendsNote =
    row.baseClassName !== undefined
      ? `  ${c.dim}extends ${row.baseClassName}${c.reset}`
      : "";
  const codeColor = row.partition === "near_miss" ? c.red : c.dim;

  return [
    `  ${row.partition === "near_miss" ? c.red : c.dim}✖${c.reset} ${c.bold}${pad(name, nameWidth)}${c.reset}${contract}` +
      `  ${codeColor}${row.skipReason}${c.reset}${extendsNote}`,
    ...(row.partition === "near_miss" && row.gloss !== undefined
      ? [`      ${c.dim}→ ${row.gloss}${c.reset}`]
      : []),
  ];
};

/**
 * Units reachable both inside and outside a declaring scope-root subtree.
 *
 * One line each, no taxonomy: the point is that a reader (or a migration) can see WHICH unit and
 * WHICH key caused a late-bound value to stay in `IocExternals`, rather than deducing it from an
 * externals entry they did not expect.
 */
const formatSharedScopeRootUnitsSection = (
  units: readonly ScopeRootSharedSubtreeUnit[],
  c: Ansi,
): string[] => {
  if (units.length === 0) return [];

  const lines: string[] = [`${c.bold}Shared scope-root units:${c.reset}`];
  for (const unit of units) {
    lines.push(
      `  ${c.yellow}!${c.reset} ${c.bold}${unit.exportName}${c.reset}` +
        ` ${c.dim}(${unit.modulePath})${c.reset}` +
        ` demands ${unit.key} inside ${unit.declaringVariants.join(", ")}` +
        ` ${c.dim}and is reachable from outside it — ${unit.key} stays in IocExternals${c.reset}`,
    );
  }
  lines.push("");
  return lines;
};

const formatSummary = (report: DiscoveryReport, c: Ansi): string[] => {
  const s = report.summary;
  return [
    `${c.bold}Summary:${c.reset} ${s.filesScanned} file(s) scanned · ` +
      `${s.unitsDiscovered} unit(s) discovered · ` +
      `${s.nearMisses} near-miss(es) · ` +
      `${s.notACandidateFiles} not-a-candidate file(s)`,
    `         ${s.filesExcludedByConfig} file(s) excluded by config`,
  ];
};

export const formatDiscoveryReport = (
  report: DiscoveryReport,
  options?: FormatDiscoveryReportOptions,
): string => {
  const color =
    options?.color !== undefined ? options.color : shouldColorize();
  const verbose = options?.verbose === true;
  const c = ansi(color);
  const lines: string[] = [];

  for (const file of report.files) {
    const visible = file.rows.filter((row) => isVisibleRow(row, verbose));
    // A file that holds nothing but not-a-candidate rows is omitted entirely — printing its name
    // with no rows under it is the noise the partition exists to remove.
    if (visible.length === 0) continue;

    lines.push(`${c.bold}${c.cyan}${file.modulePath}${c.reset}`);

    const nameWidth = Math.min(
      NAME_COLUMN_CAP,
      Math.max(0, ...visible.map((row) => (row.exportName ?? "(whole file)").length)),
    );

    for (const row of visible) {
      lines.push(...formatRow(row, nameWidth, c));
    }

    lines.push("");
  }

  lines.push(
    ...formatSharedScopeRootUnitsSection(report.scopeRootSharedUnits, c),
  );
  lines.push(...formatGroupsSection(report.groups, c));

  lines.push(...formatSummary(report, c));

  if (report.filter !== undefined) {
    lines.push(
      `${c.dim}Rows filtered by --contract ${JSON.stringify(report.filter.contract)}; counts above are for the full scan.${c.reset}`,
    );
  }
  if (!verbose && report.summary.notACandidateFiles > 0) {
    lines.push(
      `${c.dim}Run with --verbose to show not-a-candidate rows.${c.reset}`,
    );
  }

  return lines.join("\n").trimEnd();
};
