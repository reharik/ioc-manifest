import type { DiscoveryReport, InspectionReport } from "./reports.js";
import type { ManifestValidationIssue } from "./validateManifest.js";

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

export const formatDiscoveryReport = (report: DiscoveryReport): string => {
  const lines: string[] = [];

  for (const file of report.files) {
    lines.push(file.sourceFilePath);

    for (const row of file.rows) {
      const statusIcon = row.status === "discovered" ? "✔" : "✖";

      if (row.exportName === undefined) {
        lines.push(`  ${statusIcon} ${row.status}`);
        if (row.skipReason) {
          lines.push(`    reason: ${row.skipReason}`);
        }
        continue;
      }

      lines.push(`  ${statusIcon} ${row.exportName}`);

      if (row.contractName) {
        lines.push(`    contract: ${row.contractName}`);
      }

      if (row.registrationKey) {
        lines.push(`    registrationKey: ${row.registrationKey}`);
      }

      if (row.skipReason) {
        lines.push(`    reason: ${row.skipReason}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
};
