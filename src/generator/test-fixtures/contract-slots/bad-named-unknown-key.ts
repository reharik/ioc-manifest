import type { Named } from "../../../named/named.js";
import type { AuthMiddleware, RequestPipeline } from "./contracts.js";

/**
 * The marker on a key no implementation is registered under, local or composed. An unregistered key
 * is an external and is demanded by its plain type.
 */
type UnknownKeyDeps = { viewerAuthMiddleware: Named<AuthMiddleware> };

export const buildUnknownKeyPipeline = ({
  viewerAuthMiddleware,
}: UnknownKeyDeps): RequestPipeline => ({
  run: (path: string) => viewerAuthMiddleware.handle(path),
});
