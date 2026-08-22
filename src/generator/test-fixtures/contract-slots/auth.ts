import type { AuthMiddleware, AuditSink } from "./contracts.js";

/**
 * Elected by `registrations.AuthMiddleware.optionalAuthMiddleware.default`, so the contract slot key
 * `authMiddleware` resolves here.
 */
export const buildOptionalAuthMiddleware = (): AuthMiddleware => ({
  name: "optional",
  handle: (path: string) => path,
});

/** Registered as `strictAuthMiddleware`; reachable only by that name, and only with `Named<…>`. */
export const buildStrictAuthMiddleware = (): AuthMiddleware => ({
  name: "strict",
  handle: (path: string) => `strict:${path}`,
});

export const buildAuditSink = (): AuditSink => ({
  write: () => {
    /* noop */
  },
});
