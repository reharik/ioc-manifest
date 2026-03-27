import type { MediaStorage } from "./b-multiple-implementations.js";
export type Widget = {
    id: string;
};
/**
 * Scenario C1: extra `MediaStorage` implementation with resolver `key` `mediaStorage` (distinct from other keys).
 */
export declare const buildMediaStorage: () => MediaStorage;
/**
 * Scenario C2 helpers: two competing implementations (used from runExample with explicit `default` + overrides).
 * Keys are unique for the playground manifest.
 */
export declare const buildPrimaryWidget: () => Widget;
export declare const buildSecondaryWidget: () => Widget;
//# sourceMappingURL=c-default-selection.d.ts.map