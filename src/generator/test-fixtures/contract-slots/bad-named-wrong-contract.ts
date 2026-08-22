import type { Named } from "../../../named/named.js";
import type { AuditSink, RequestPipeline } from "./contracts.js";

/**
 * `Named<C>` where the implementation's declared contract is not `C`. Strict identity, never
 * assignability: the demand names `AuditSink`, `strictAuthMiddleware` declares `AuthMiddleware`.
 */
type WrongContractDeps = { strictAuthMiddleware: Named<AuditSink> };

export const buildWrongContractPipeline = ({
  strictAuthMiddleware,
}: WrongContractDeps): RequestPipeline => ({
  run: () => {
    strictAuthMiddleware.write("x");
    return "x";
  },
});
