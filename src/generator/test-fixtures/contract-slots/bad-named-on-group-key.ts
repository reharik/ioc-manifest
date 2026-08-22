import type { Named } from "../../../named/named.js";
import type { AuthMiddleware, RequestPipeline } from "./contracts.js";

/**
 * The marker on a GROUP root key (`authMiddlewaresGroup` in the fixture config). A group key
 * resolves the whole collection, not one implementation.
 */
type MarkedGroupDeps = {
  authMiddlewaresGroup: Named<AuthMiddleware>;
};

export const buildMarkedGroupPipeline = ({
  authMiddlewaresGroup,
}: MarkedGroupDeps): RequestPipeline => ({
  run: (path: string) => authMiddlewaresGroup.handle(path),
});
