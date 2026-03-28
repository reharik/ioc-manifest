import { formatBundlePlanIssue } from "../bundles/resolveBundlePlan.js";
import { validateBundleInsight, validateContainerContractsView, validateManifest, } from "./validateManifest.js";
const isRegistrationManifest = (contracts) => {
    for (const implMap of Object.values(contracts)) {
        for (const row of Object.values(implMap)) {
            return (row != null &&
                typeof row === "object" &&
                "moduleIndex" in row);
        }
    }
    return false;
};
const pickDefaultRegistration = (impls) => {
    const list = Object.values(impls);
    const marked = list.filter((m) => m.default === true);
    if (marked.length === 1) {
        const meta = marked[0];
        return { name: meta.implementationName, meta };
    }
    if (list.length === 1) {
        const meta = list[0];
        return { name: meta.implementationName, meta };
    }
    return undefined;
};
const pickDefaultLean = (impls) => {
    const implKeys = Object.keys(impls).sort((a, b) => a.localeCompare(b));
    if (implKeys.length === 1) {
        const k = implKeys[0];
        return { name: k, meta: impls[k] };
    }
    const withDefault = implKeys.filter((k) => impls[k].default === true);
    if (withDefault.length === 1) {
        const k = withDefault[0];
        return { name: k, meta: impls[k] };
    }
    return undefined;
};
export const buildInspectionReport = (contracts, options) => {
    const manifestIssues = options?.registrationManifest !== undefined
        ? validateManifest(options.registrationManifest)
        : isRegistrationManifest(contracts)
            ? validateManifest(contracts)
            : validateContainerContractsView(contracts);
    const contractNames = Object.keys(contracts).sort((a, b) => a.localeCompare(b));
    const contractsOut = contractNames.map((contractName) => {
        const impls = contracts[contractName];
        const implKeys = Object.keys(impls).sort((a, b) => a.localeCompare(b));
        if (isRegistrationManifest(contracts)) {
            const full = impls;
            const selected = pickDefaultRegistration(full);
            return {
                contractName,
                defaultImplementationName: selected?.name,
                defaultRegistrationKey: selected?.meta.registrationKey,
                implementations: implKeys.map((k) => {
                    const m = full[k];
                    return {
                        implementationName: m.implementationName,
                        registrationKey: m.registrationKey,
                        lifecycle: m.lifetime,
                        sourceFilePath: m.sourceFilePath ?? m.modulePath,
                        exportName: m.exportName,
                        isDefault: m.default === true || implKeys.length === 1,
                    };
                }),
            };
        }
        const lean = impls;
        const selected = pickDefaultLean(lean);
        return {
            contractName,
            defaultImplementationName: selected?.name,
            defaultRegistrationKey: selected?.meta.registrationKey,
            implementations: implKeys.map((k) => {
                const m = lean[k];
                return {
                    implementationName: k,
                    registrationKey: m.registrationKey,
                    lifecycle: m.lifetime,
                    sourceFilePath: m.sourceFile,
                    exportName: m.exportName,
                    isDefault: m.default === true || implKeys.length === 1,
                };
            }),
        };
    });
    return { contracts: contractsOut, manifestIssues };
};
const outcomeToRows = (sourceFilePath, outcome) => {
    if (outcome.scope === "file") {
        return [
            {
                sourceFilePath,
                status: "skipped",
                skipReason: outcome.skipReason,
            },
        ];
    }
    if (outcome.status === "discovered") {
        return [
            {
                sourceFilePath,
                exportName: outcome.exportName,
                status: "discovered",
                contractName: outcome.contractName,
                registrationKey: outcome.registrationKey,
            },
        ];
    }
    return [
        {
            sourceFilePath,
            exportName: outcome.exportName,
            status: "skipped",
            skipReason: outcome.skipReason,
            contractName: outcome.contractName,
        },
    ];
};
const isDiscoveryFilesArray = (input) => Array.isArray(input);
export const buildDiscoveryReport = (analysisOrFiles) => {
    const discoveryFiles = isDiscoveryFilesArray(analysisOrFiles)
        ? analysisOrFiles
        : analysisOrFiles.discoveryFiles;
    const files = discoveryFiles
        .slice()
        .sort((a, b) => a.sourceFilePath.localeCompare(b.sourceFilePath))
        .map((file) => ({
        sourceFilePath: file.sourceFilePath,
        rows: file.outcomes.flatMap((o) => outcomeToRows(file.sourceFilePath, o)),
    }));
    return { files };
};
export const buildBundleReport = (insight, bundleAnalysis) => {
    const insightIssues = validateBundleInsight(insight);
    const analysisMessages = [];
    if (bundleAnalysis !== undefined && bundleAnalysis.ok === false) {
        for (const issue of bundleAnalysis.issues) {
            analysisMessages.push(formatBundlePlanIssue(issue));
        }
    }
    const bundles = insight === undefined
        ? []
        : [...insight]
            .sort((a, b) => a.bundlePath.localeCompare(b.bundlePath))
            .map((row) => ({
            bundlePath: row.bundlePath,
            declaredMembers: row.declaredMembers,
            expandedMembers: row.expandedMembers,
            validationMessages: [],
        }));
    const syntheticIssues = analysisMessages.map((message, i) => ({
        code: `bundle_analysis_${i}`,
        message,
    }));
    return {
        bundles,
        issues: [...insightIssues, ...syntheticIssues],
    };
};
export const bundleIssuesFromAnalysis = (issues) => issues.map((i) => formatBundlePlanIssue(i));
//# sourceMappingURL=reports.js.map