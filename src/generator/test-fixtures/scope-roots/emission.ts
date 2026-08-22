/**
 * Two variants of one root contract, written so stage-3 EMISSION is observable.
 *
 * Every declared late-bound value is a named, exported type, because the opener's parameter type is
 * emitted by import and never inlined — the declared-not-derived discipline applied to emitted text.
 * Both variants demand what they declare and nothing more, so the fixture carries no findings and
 * emission can be asserted without a verification failure in the way.
 */
import type { Named } from "../../../named/named.js";
import type { ScopeRoot } from "../../../scopeRoots/scopeRoot.js";
import type {
  IAuditLog,
  IRequestRouter,
  Principal,
  UnitOfWork,
} from "./deps-contracts.js";

type EmissionAuditDeps = { principal: Principal };

/** One level under the root: the variant that declares `principal` reaches it through here. */
export const buildEmissionAudit = ({
  principal,
}: EmissionAuditDeps): IAuditLog => ({
  record: (event: string) => {
    void `${principal.id}:${event}`;
  },
});

type AuthRouterDeps = { emissionAudit: Named<IAuditLog>; uow: UnitOfWork };

/** Variant one: an authenticated boundary carrying a principal and a unit of work. */
export const buildAuthRouter = ({
  emissionAudit,
  uow,
}: AuthRouterDeps): ScopeRoot<
  IRequestRouter,
  { principal: Principal; uow: UnitOfWork }
> => ({
  handle: (path: string) => {
    emissionAudit.record(path);
    void uow;
    return path;
  },
});

type PublicRouterDeps = { uow: UnitOfWork };

/** Variant two: a public boundary carrying only a unit of work. Same contract, different scope. */
export const buildPublicRouter = ({
  uow,
}: PublicRouterDeps): ScopeRoot<IRequestRouter, { uow: UnitOfWork }> => ({
  handle: (path: string) => {
    void uow;
    return path;
  },
});
