/**
 * Two variants of ONE root contract, built so the assignability direction of the lbv check is
 * observable and so the two variants must be judged independently.
 *
 * `AdminPrincipal extends Principal`, and never the inverse:
 *
 * - `narrowRouter` supplies `AdminPrincipal` where the subtree demands `Principal` — supplied
 *   extends demanded, so it PASSES. Running the check backwards would reject it.
 * - `wideRouter` supplies `Principal` where the subtree demands `AdminPrincipal` — supplied does
 *   not extend demanded, so it FAILS. Running the check backwards would accept it.
 *
 * Both declare `ScopeRoot<IRequestRouter, ...>`, so a check that unioned or intersected the lbv
 * sets of a root contract's variants would score them the same. They must not score the same.
 */
import type { ScopeRoot } from "../../../scopeRoots/scopeRoot.js";
import type {
  AdminPrincipal,
  IAuditLog,
  IRequestRouter,
  Principal,
} from "./deps-contracts.js";

type BasicAuditDeps = { principal: Principal };

export const buildBasicAudit = ({ principal }: BasicAuditDeps): IAuditLog => ({
  record: (event: string) => {
    void `${principal.id}:${event}`;
  },
});

type AdminAuditDeps = { principal: AdminPrincipal };

export const buildAdminAudit = ({ principal }: AdminAuditDeps): IAuditLog => ({
  record: (event: string) => {
    void `${principal.role}:${event}`;
  },
});

type NarrowRouterDeps = { basicAudit: IAuditLog };

/** Supplied `AdminPrincipal` extends demanded `Principal` — satisfied. */
export const buildNarrowRouter = ({
  basicAudit,
}: NarrowRouterDeps): ScopeRoot<
  IRequestRouter,
  { principal: AdminPrincipal }
> => ({
  handle: (path: string) => {
    basicAudit.record(path);
    return path;
  },
});

type WideRouterDeps = { adminAudit: IAuditLog };

/** Supplied `Principal` does NOT extend demanded `AdminPrincipal` — unsatisfied. */
export const buildWideRouter = ({
  adminAudit,
}: WideRouterDeps): ScopeRoot<IRequestRouter, { principal: Principal }> => ({
  handle: (path: string) => {
    adminAudit.record(path);
    return path;
  },
});
