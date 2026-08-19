/**
 * @fileoverview Plain-text rendering of inspection/discovery reports for terminal output (`ioc` CLI).
 */
import type { DiscoveryReport, InspectionReport } from "./reports.js";
import type { ResolvedContractRegistration } from "../generator/resolveRegistrationPlan.js";
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

export const formatInspectionReport = (report: InspectionReport): string => {
  const lines: string[] = [];

  const header = formatManifestIssues(report.manifestIssues);
  if (header.length > 0) {
    lines.push(header.trimEnd());
    lines.push("");
  }

  for (const c of report.contracts) {
    lines.push(c.contractName);

    if (c.defaultImplementationName !== undefined) {
      lines.push(`  default: ${c.defaultImplementationName}`);
    } else {
      lines.push(`  default: (unresolved — see manifest validation)`);
    }

    lines.push(`  implementations:`);

    for (const impl of c.implementations) {
      lines.push(`    - ${impl.implementationName}`);
      lines.push(`      lifecycle: ${impl.lifecycle}`);
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
};

export type FormatDiscoveryReportOptions = {
  /** When omitted, uses TTY + NO_COLOR / FORCE_COLOR (same idea as common CLIs). */
  color?: boolean;
};

export const formatDiscoveryReport = (
  report: DiscoveryReport,
  options?: FormatDiscoveryReportOptions,
): string => {
  const color =
    options?.color !== undefined ? options.color : shouldColorize();
  const c = ansi(color);
  const lines: string[] = [];

  for (const file of report.files) {
    lines.push(`${c.bold}${c.cyan}${file.modulePath}${c.reset}`);

    for (const row of file.rows) {
      const isDiscovered = row.status === "discovered";
      const statusIcon = isDiscovered ? "✔" : "✖";
      const icon = `${isDiscovered ? c.green : c.red}${statusIcon}${c.reset}`;

      if (row.exportName === undefined) {
        lines.push(
          `  ${icon} ${isDiscovered ? c.green : c.yellow}${row.status}${c.reset}`,
        );
        if (row.skipReason) {
          lines.push(`    ${c.dim}reason:${c.reset} ${row.skipReason}`);
        }
        continue;
      }

      lines.push(`  ${icon} ${c.bold}${row.exportName}${c.reset}`);

      if (row.isScopeRoot === true) {
        lines.push(`    ${c.dim}unit:${c.reset} ${c.cyan}scope-root${c.reset}`);
      }

      if (row.contractName) {
        const label = row.isScopeRoot === true ? "root contract" : "contract";
        lines.push(`    ${c.dim}${label}:${c.reset} ${row.contractName}`);
      }

      if (row.declaredLbv) {
        lines.push(`    ${c.dim}declared lbv:${c.reset} ${row.declaredLbv}`);
      }

      // A scope root claims no cradle key at stage 1, so printing one would be a lie; the derived
      // name is reported as what it actually is — the variant id within the root contract.
      if (row.registrationKey && row.isScopeRoot === true) {
        lines.push(`    ${c.dim}variant:${c.reset} ${row.registrationKey}`);
      } else if (row.registrationKey) {
        lines.push(`    ${c.dim}registrationKey:${c.reset} ${row.registrationKey}`);
      }

      if (row.skipReason) {
        lines.push(
          `    ${c.dim}reason:${c.reset} ${c.red}${row.skipReason}${c.reset}`,
        );
      }

      if (row.baseClassName) {
        lines.push(`    ${c.dim}extends:${c.reset} ${row.baseClassName}`);
      }
    }

    lines.push("");
  }

  if (report.scopeRoots.length > 0) {
    lines.push(`${c.bold}Scope roots:${c.reset}`);
    for (const root of report.scopeRoots) {
      lines.push(
        `  ${c.bold}${root.contractName}${c.reset} ${c.dim}(lifetime: ${root.lifetime}; not manifest-emitted at this stage)${c.reset}`,
      );
      for (const variant of root.variants) {
        lines.push(`    - ${variant.variantName}`);
        lines.push(
          `      ${c.dim}export:${c.reset} ${variant.exportName} ${c.dim}in${c.reset} ${variant.modulePath}`,
        );
        lines.push(
          `      ${c.dim}declared lbv:${c.reset} ${variant.declaredLbv}`,
        );
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
};

/** Resolved lifetime + source line per implementation (from registration plan; used with `ioc inspect --discovery`). */
export const formatRegistrationLifetimeInspect = (
  plan: readonly ResolvedContractRegistration[],
): string => {
  const contracts = [...plan].sort((a, b) =>
    a.contractName.localeCompare(b.contractName),
  );
  const lines: string[] = ["Resolved registration lifetimes:"];

  for (const c of contracts) {
    lines.push(`  ${c.contractName}`);
    const impls = [...c.implementations].sort((a, b) =>
      a.implementationName.localeCompare(b.implementationName),
    );
    for (const impl of impls) {
      lines.push(`    - ${impl.implementationName}`);
      lines.push(`      lifetime: ${impl.lifetime}`);
      if (impl.lifetimeSource !== undefined) {
        lines.push(`      lifetimeSource: ${impl.lifetimeSource}`);
      }
    }
  }

  return lines.join("\n").trimEnd();
};
