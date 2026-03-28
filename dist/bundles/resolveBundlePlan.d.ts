import type { IocBundleArrayInsight } from "../core/manifest.js";
import type { ResolvedContractRegistration } from "../generator/resolveRegistrationPlan.js";
export type IocBundleReference = {
    $bundleRef: string;
};
export type IocBundleLeaf = string | IocBundleReference;
export interface IocBundleTree {
    [key: string]: IocBundleNode;
}
export type IocBundleNode = IocBundleTree | readonly IocBundleLeaf[];
export type IocBundlesConfig = IocBundleTree;
export type ResolvedBundleLeaf = {
    contractName: string;
    registrationKey: string;
};
export interface ResolvedBundleTree {
    [key: string]: ResolvedBundleNode;
}
export type ResolvedBundleNode = ResolvedBundleTree | ResolvedBundleLeaf[];
export type BundlePlanIssue = {
    kind: "bundles_not_object";
} | {
    kind: "invalid_node_shape";
    path: string;
} | {
    kind: "invalid_array_item";
    path: string;
    index: number;
} | {
    kind: "empty_contract_string";
    path: string;
    index: number;
} | {
    kind: "unknown_contract";
    path: string;
    index: number;
    contractName: string;
    knownContracts: string[];
} | {
    kind: "unknown_bundle_ref";
    path: string;
    index: number;
    reference: string;
    knownBundlePaths: string[];
} | {
    kind: "bundle_cycle";
    cycle: string[];
} | {
    kind: "bundle_root_must_be_object";
} | {
    kind: "bundle_root_key_collision";
    key: string;
};
export type BundlePlanResult = {
    tree: ResolvedBundleTree;
    arraysInsight: IocBundleArrayInsight[];
};
type RawBundleArrayItem = string | IocBundleReference;
type RawBundleArray = readonly RawBundleArrayItem[];
export declare const formatBundlePlanIssue: (issue: BundlePlanIssue) => string;
export declare const formatBundlePlanIssues: (issues: readonly BundlePlanIssue[]) => string;
export declare const buildBundleArraysInsight: (arraysByPath: Map<string, RawBundleArray>, plans: readonly ResolvedContractRegistration[]) => IocBundleArrayInsight[];
export declare const buildBundlePlan: (bundles: unknown, plans: readonly ResolvedContractRegistration[]) => BundlePlanResult | undefined;
export type BundlePlanAnalysis = {
    ok: true;
    tree: ResolvedBundleTree | undefined;
    arraysInsight: IocBundleArrayInsight[];
} | {
    ok: false;
    tree: undefined;
    arraysInsight: [];
    issues: readonly BundlePlanIssue[];
};
export declare const analyzeBundlePlan: (bundles: unknown, plans: readonly ResolvedContractRegistration[]) => BundlePlanAnalysis;
export {};
//# sourceMappingURL=resolveBundlePlan.d.ts.map