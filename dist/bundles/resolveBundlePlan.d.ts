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
export declare const buildBundlePlan: (bundles: unknown, plans: readonly ResolvedContractRegistration[]) => ResolvedBundleTree | undefined;
//# sourceMappingURL=resolveBundlePlan.d.ts.map