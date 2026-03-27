import { type AwilixContainer } from "awilix";
import type { IocBundlesManifest, IocContractManifest, IocModuleNamespace } from "../core/manifest.js";
/**
 * Registers discovered injectable factories from a generated manifest into an Awilix container.
 * Call order:
 * 1. concrete implementation factories
 * 2. default contract aliases
 * 3. multi-implementation collections
 */
export declare const registerIocFromManifest: <TCradle extends object>(container: AwilixContainer<TCradle>, manifestByContract: IocContractManifest, moduleImports: readonly IocModuleNamespace[], bundlesManifest?: IocBundlesManifest) => void;
//# sourceMappingURL=bootstrap.d.ts.map