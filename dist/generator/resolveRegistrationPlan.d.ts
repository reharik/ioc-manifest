import type { IocConfig, IocLifetime, IocOverride } from "../config/iocConfig.js";
import type { IocConfigOverrideField } from "../core/manifest.js";
import type { DiscoveredFactory } from "./types.js";
export type ResolvedImplementationEntry = {
    /** Stable implementation id from discovery (factory export / resolver map key). */
    implementationName: string;
    /** Awilix/container registration name (respects resolver `key` / `name`). */
    registrationKey: string;
    exportName: string;
    modulePath: string;
    relImport: string;
    lifetime: IocLifetime;
    discoveredBy?: "naming" | "injectable-wrapper";
    /** Fields present on the matching `ioc.config` registration override for this implementation. */
    configOverridesApplied?: readonly IocConfigOverrideField[];
    dependencyContractNames?: readonly string[];
};
export type ResolvedContractRegistration = {
    contractName: string;
    /**
     * Type-only import path for the contract symbol (from discovery; same for all implementations).
     * Independent of which implementation is the runtime default.
     */
    contractTypeRelImport: string;
    /** Default binding key, e.g. `mediaStorage`. */
    contractKey: string;
    /** Plural collection key when there is more than one implementation; otherwise undefined. */
    collectionKey: string | undefined;
    /** Which implementation is selected for the default contract key (implementation name). */
    defaultImplementationName: string;
    implementations: ResolvedImplementationEntry[];
};
/**
 * Maps config-only `name` into the internal `registrationKey` field; spreads the rest so
 * future override keys that match {@link DiscoveredFactory} merge without extra wiring.
 */
export declare const normalizeIocOverride: (override: IocOverride) => Partial<DiscoveredFactory>;
export declare const validateConfigContractsExist: (config: IocConfig | undefined, contractNames: Set<string>) => void;
export declare const buildRegistrationPlan: (contractMap: Map<string, Map<string, DiscoveredFactory>>, config?: IocConfig) => ResolvedContractRegistration[];
//# sourceMappingURL=resolveRegistrationPlan.d.ts.map