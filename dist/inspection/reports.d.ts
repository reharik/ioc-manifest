import type { BundlePlanAnalysis, BundlePlanIssue } from "../bundles/resolveBundlePlan.js";
import type { IocBundleArraysInsightManifest, IocContainerContractsView, IocContractManifest } from "../core/manifest.js";
import type { IocDiscoveryAnalysisFiles } from "../generator/discoverFactories/discoveryOutcomeTypes.js";
import type { ManifestValidationIssue } from "./validateManifest.js";
/** Result shape from {@link runDiscoveryAnalysis}; inlined to avoid import cycles. */
export type DiscoveryReportInput = IocDiscoveryAnalysisFiles | {
    discoveryFiles: IocDiscoveryAnalysisFiles;
};
export type InspectionContractsInput = IocContainerContractsView | IocContractManifest;
export type InspectionContractReport = {
    contractName: string;
    defaultImplementationName: string | undefined;
    defaultRegistrationKey: string | undefined;
    implementations: readonly {
        implementationName: string;
        registrationKey: string;
        lifecycle: string;
        sourceFilePath: string;
        exportName: string;
        isDefault: boolean;
    }[];
};
export type InspectionReport = {
    contracts: readonly InspectionContractReport[];
    manifestIssues: readonly ManifestValidationIssue[];
};
export declare const buildInspectionReport: (contracts: InspectionContractsInput, options?: {
    registrationManifest?: IocContractManifest;
}) => InspectionReport;
export type DiscoveryExportReportRow = {
    sourceFilePath: string;
    exportName?: string;
    status: "discovered" | "skipped";
    contractName?: string;
    skipReason?: string;
    registrationKey?: string;
};
export type DiscoveryReport = {
    files: readonly {
        sourceFilePath: string;
        rows: readonly DiscoveryExportReportRow[];
    }[];
};
export declare const buildDiscoveryReport: (analysisOrFiles: DiscoveryReportInput) => DiscoveryReport;
export type BundleReportRow = {
    bundlePath: string;
    declaredMembers: readonly unknown[];
    expandedMembers: readonly {
        contractName: string;
        registrationKey: string;
    }[];
    validationMessages: readonly string[];
};
export type BundleReport = {
    bundles: readonly BundleReportRow[];
    issues: readonly ManifestValidationIssue[];
};
export declare const buildBundleReport: (insight: IocBundleArraysInsightManifest | undefined, bundleAnalysis?: BundlePlanAnalysis) => BundleReport;
export declare const bundleIssuesFromAnalysis: (issues: readonly BundlePlanIssue[]) => string[];
//# sourceMappingURL=reports.d.ts.map