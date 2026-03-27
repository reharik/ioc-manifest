/**
 * Scenario C1: extra `MediaStorage` implementation with resolver `key` `mediaStorage` (distinct from other keys).
 */
export const buildMediaStorage = () => {
    return {
        label: "direct-contract",
        put: async () => {
            /* noop */
        },
    };
};
/**
 * Scenario C2 helpers: two competing implementations (used from runExample with explicit `default` + overrides).
 * Keys are unique for the playground manifest.
 */
export const buildPrimaryWidget = () => ({
    id: "primary",
});
export const buildSecondaryWidget = () => ({
    id: "secondary",
});
//# sourceMappingURL=c-default-selection.js.map