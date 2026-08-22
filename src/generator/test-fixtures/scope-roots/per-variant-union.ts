/**
 * Two variants over one shared subtree key, where exactly one variant declares it — plus a control
 * key only the declaring variant touches at all.
 *
 * `declaringRouter` names `sessionToken` in its lbv: its opening sites supply it per-open.
 * `inheritingRouter` does not: it consumes the container constant through the parent chain. That
 * per-variant divergence is legal, and it is the shape that breaks in two different ways if the
 * Externals-exclusion union is got wrong:
 *
 * - if the union leaks into VERIFICATION, `inheritingRouter` is told to declare a key it
 *   deliberately does not carry, because ANOTHER variant declared it;
 * - if the union excludes `sessionToken` from `Externals`, the typed surface stops asking the app
 *   for the container constant `inheritingRouter` resolves, and the failure moves from a
 *   composition-time type error to a production resolution error.
 *
 * `requestId` is the control: declared by `declaringRouter`, demanded by nothing else. Nothing
 * consumes it from the container, so it IS excluded and the config never has to repeat it.
 */
import type { Named } from "../../../named/named.js";
import type { ScopeRoot } from "../../../scopeRoots/scopeRoot.js";
import type { IAuditLog, IRequestRouter } from "./deps-contracts.js";

export interface SessionToken {
  value: string;
}

/** The control key: only the declaring variant ever demands it, and it declares it. */
export interface RequestId {
  value: string;
}

type TokenAuditDeps = { sessionToken: SessionToken };

export const buildTokenAudit = ({ sessionToken }: TokenAuditDeps): IAuditLog => ({
  record: (event: string) => {
    void `${sessionToken.value}:${event}`;
  },
});

type DeclaringRouterDeps = {
  tokenAudit: Named<IAuditLog>;
  requestId: RequestId;
};

/** Carries both keys at the boundary. */
export const buildDeclaringRouter = ({
  tokenAudit,
  requestId,
}: DeclaringRouterDeps): ScopeRoot<
  IRequestRouter,
  { sessionToken: SessionToken; requestId: RequestId }
> => ({
  handle: (path: string) => {
    tokenAudit.record(path);
    return `${requestId.value}:${path}`;
  },
});

type InheritingRouterDeps = { tokenAudit: Named<IAuditLog> };

/** Inherits the token from the container. Same subtree, different boundary. */
export const buildInheritingRouter = ({
  tokenAudit,
}: InheritingRouterDeps): ScopeRoot<IRequestRouter, Record<string, never>> => ({
  handle: (path: string) => {
    tokenAudit.record(path);
    return path;
  },
});
