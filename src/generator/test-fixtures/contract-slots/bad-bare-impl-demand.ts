import type { AuthMiddleware, RequestPipeline } from "./contracts.js";

/**
 * The retired spelling: an implementation registration key demanded with a bare contract type.
 *
 * Legal until now only because the key happened to be registered — indistinguishable at the site
 * from a contract-key demand and from an external. Now a hard error naming both legal spellings.
 */
type BareDemandDeps = { strictAuthMiddleware: AuthMiddleware };

export const buildBarePipeline = ({
  strictAuthMiddleware,
}: BareDemandDeps): RequestPipeline => ({
  run: (path: string) => strictAuthMiddleware.handle(path),
});
