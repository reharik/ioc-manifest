import type { Named } from "../../../named/named.js";
import type { AuthMiddleware, RequestPipeline } from "./contracts.js";

/** Both legal spellings of a contract-typed demand, side by side. */
type RequestPipelineDeps = {
  /** The contract key: whichever implementation is elected. */
  authMiddleware: AuthMiddleware;
  /** That specific implementation, declared as one. */
  strictAuthMiddleware: Named<AuthMiddleware>;
};

export const buildRequestPipeline = ({
  authMiddleware,
  strictAuthMiddleware,
}: RequestPipelineDeps): RequestPipeline => ({
  run: (path: string) =>
    `${authMiddleware.handle(path)}|${strictAuthMiddleware.handle(path)}`,
});
