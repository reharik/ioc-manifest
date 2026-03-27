import type { IocBundlesConfig } from "../bundles/resolveBundlePlan.js";
export type IocLifetime = "singleton" | "scoped" | "transient";
/**
 * Per-implementation overrides keyed by contract name, then discovered implementation name.
 * `name` sets the Awilix registration key (maps to internal `registrationKey`).
 * Other fields align with {@link DiscoveredFactory} so new override keys can match the planning model.
 */
export type IocOverride = {
    /** Awilix/container registration key; applied as `registrationKey` during planning. */
    name?: string;
    lifetime?: IocLifetime;
    default?: boolean;
};
export type IocConfig = {
    discovery: {
        rootDir: string;
        includes?: string[];
        excludes?: string[];
        factoryPrefix?: string;
        /** Where generator output is written, relative to `rootDir` unless absolute. Default: "generated". */
        generatedDir?: string;
    };
    registrations?: Record<string, Record<string, IocOverride>>;
    bundles?: IocBundlesConfig;
};
export declare const defineIocConfig: (config: IocConfig) => IocConfig;
//# sourceMappingURL=iocConfig.d.ts.map