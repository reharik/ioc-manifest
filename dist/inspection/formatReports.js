const formatDeclaredMember = (m) => {
    if (typeof m === "string") {
        return JSON.stringify(m);
    }
    if (typeof m === "object" &&
        m !== null &&
        "$bundleRef" in m &&
        typeof m.$bundleRef === "string") {
        return `{ $bundleRef: ${JSON.stringify(m.$bundleRef)} }`;
    }
    return JSON.stringify(m);
};
const formatManifestIssues = (issues) => {
    if (issues.length === 0) {
        return "";
    }
    return [
        "Manifest validation:",
        ...issues.map((i) => `  - [${i.code}] ${i.message}`),
        "",
    ].join("\n");
};
export const formatInspectionReport = (report) => {
    const lines = [];
    const header = formatManifestIssues(report.manifestIssues);
    if (header.length > 0) {
        lines.push(header.trimEnd());
        lines.push("");
    }
    for (const c of report.contracts) {
        lines.push(c.contractName);
        if (c.defaultImplementationName !== undefined) {
            lines.push(`  default: ${c.defaultImplementationName}`);
        }
        else {
            lines.push(`  default: (unresolved — see manifest validation)`);
        }
        lines.push(`  implementations:`);
        for (const impl of c.implementations) {
            lines.push(`    - ${impl.implementationName}`);
            lines.push(`      lifecycle: ${impl.lifecycle}`);
            lines.push(`      source: ${impl.sourceFilePath}`);
        }
        lines.push("");
    }
    return lines.join("\n").trimEnd();
};
export const formatDiscoveryReport = (report) => {
    const lines = [];
    for (const file of report.files) {
        lines.push(file.sourceFilePath);
        for (const row of file.rows) {
            if (row.exportName === undefined) {
                lines.push(`  ${row.status === "discovered" ? "✔" : "✖"} ${row.status}`);
                if (row.skipReason !== undefined) {
                    lines.push(`  reason: ${row.skipReason}`);
                }
                continue;
            }
            lines.push(`  ${row.status === "discovered" ? "✔" : "✖"} ${row.status}`);
            lines.push(`  export: ${row.exportName}`);
            if (row.contractName !== undefined) {
                lines.push(`  contract: ${row.contractName}`);
            }
            if (row.registrationKey !== undefined) {
                lines.push(`  registrationKey: ${row.registrationKey}`);
            }
            if (row.skipReason !== undefined) {
                lines.push(`  reason: ${row.skipReason}`);
            }
        }
        lines.push("");
    }
    return lines.join("\n").trimEnd();
};
export const formatBundleReport = (report) => {
    const lines = [];
    if (report.issues.length > 0) {
        lines.push("Issues:");
        for (const i of report.issues) {
            lines.push(`  - [${i.code}] ${i.message}`);
        }
        lines.push("");
    }
    if (report.bundles.length === 0) {
        lines.push("(No bundle arrays in manifest insight.)");
        return lines.join("\n").trimEnd();
    }
    for (const b of report.bundles) {
        lines.push(b.bundlePath);
        lines.push("  declared:");
        for (const m of b.declaredMembers) {
            lines.push(`    - ${formatDeclaredMember(m)}`);
        }
        lines.push("  expanded:");
        for (const e of b.expandedMembers) {
            lines.push(`    - ${e.contractName}`);
        }
        lines.push("");
    }
    return lines.join("\n").trimEnd();
};
//# sourceMappingURL=formatReports.js.map