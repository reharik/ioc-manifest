import type { Named } from "../../../named/named.js";
import type { AuditSink, AuthMiddleware, RequestPipeline } from "./contracts.js";

/**
 * `Named` with two type arguments: more than the marker has. Follows the `scope_root_wrong_arity`
 * precedent — writing the marker at all is an unambiguous attempt to declare a named-instance
 * demand, so an unreadable declaration is demanded rather than guessed at.
 *
 * The annotation is intentionally ill-formed (tsc also rejects it); the generator reads it
 * syntactically and never type-checks or executes this file.
 */
type WrongArityDeps = {
  strictAuthMiddleware: Named<AuthMiddleware, AuditSink>;
};

export const buildWrongArityPipeline = ({
  strictAuthMiddleware,
}: WrongArityDeps): RequestPipeline => ({
  run: (path: string) => strictAuthMiddleware.handle(path),
});
