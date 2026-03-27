import type { DiscoveredFactory } from "./types.js";
import type { ResolvedContractRegistration } from "./resolveRegistrationPlan.js";
import type { ResolvedBundleTree } from "../bundles/resolveBundlePlan.js";
export declare const writeManifest: (acceptedFactories: DiscoveredFactory[], plans: ResolvedContractRegistration[], bundlesPlan: ResolvedBundleTree | undefined, manifestOutPath: string, projectRoot: string) => Promise<void>;
//# sourceMappingURL=writeManifest.d.ts.map