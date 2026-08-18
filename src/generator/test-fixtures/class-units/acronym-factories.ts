import type { ApiClient, HttpsProxy, MediaStorage } from "./contracts.js";

/**
 * Acronym-leading factory export names. v3 derives these keys with the same camelCase rule class
 * names use, so `buildAPIClient` and `class APIClient` reach the cradle under one spelling.
 * Through v2 this factory registered as `aPIClient`.
 */
export const buildAPIClient = (): ApiClient => ({ call: () => "ok" });

export const buildHTTPSProxy = (): HttpsProxy => ({ forward: () => "ok" });

/** Ordinary name — unchanged by the unification, and the control for these cases. */
export const buildS3MediaStorage = (): MediaStorage => ({
  label: "s3",
  put: () => {
    /* noop */
  },
});
