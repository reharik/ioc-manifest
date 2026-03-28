import type { IocBundleArraysInsightManifest, IocContainerContractsView, IocContractManifest } from "../core/manifest.js";
export type ManifestValidationIssue = {
    code: string;
    contractName?: string;
    message: string;
};
export declare const validateManifest: (manifestByContract: IocContractManifest) => ManifestValidationIssue[];
export declare const validateContainerContractsView: (contracts: IocContainerContractsView) => ManifestValidationIssue[];
export declare const validateBundleInsight: (insight: IocBundleArraysInsightManifest | undefined) => ManifestValidationIssue[];
//# sourceMappingURL=validateManifest.d.ts.map