import type { Named } from "../../../named/named.js";
import type { AuthMiddleware, RequestPipeline } from "./contracts.js";

/**
 * The marker on a CONTRACT slot key. The slot resolves whichever implementation is elected, so
 * "that specific implementation" is not something it can say.
 */
type MarkedSlotDeps = { authMiddleware: Named<AuthMiddleware> };

export const buildMarkedSlotPipeline = ({
  authMiddleware,
}: MarkedSlotDeps): RequestPipeline => ({
  run: (path: string) => authMiddleware.handle(path),
});
