import type { MediaStorage } from "./b-multiple-implementations.js";

export type Widget = { id: string };

/**
 * Scenario C1: extra `MediaStorage` implementation with resolver `key` `mediaStorage` (distinct from other keys).
 */
export const buildMediaStorage = (): MediaStorage => {
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
export const buildPrimaryWidget = (): Widget => ({
  id: "primary",
});

export const buildSecondaryWidget = (): Widget => ({
  id: "secondary",
});
