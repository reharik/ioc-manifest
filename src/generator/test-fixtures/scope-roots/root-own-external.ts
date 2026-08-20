/**
 * A key demanded by the scope-root unit ITSELF and declared in no variant's lbv.
 *
 * Stage 2 could only treat this as an undeclared late-bound value: scope roots were invisible to
 * `analyzeDemandSupply`, so the key reached neither the externals set nor the emitted `Externals`
 * interface, and nothing downstream would ever have checked it. With the stage-3 join the root
 * demands like any other unit, so the key flows to `Externals` and composition checks it — which is
 * the backstop whose absence made the stage-2 strictness necessary in the first place.
 */
import type { ScopeRoot } from "../../../scopeRoots/scopeRoot.js";
import type { IAuditLog, IRequestRouter } from "./deps-contracts.js";

/** A container constant the composing app registers on the root container. */
export interface TenantContext {
  id: string;
}

export const buildRootOwnAudit = (): IAuditLog => ({
  record: (event: string) => {
    void event;
  },
});

type TenantRouterDeps = { rootOwnAudit: IAuditLog; tenantContext: TenantContext };

/** Declares an empty lbv: `tenantContext` is a container constant, not a late-bound value. */
export const buildTenantRouter = ({
  rootOwnAudit,
  tenantContext,
}: TenantRouterDeps): ScopeRoot<IRequestRouter, Record<string, never>> => ({
  handle: (path: string) => {
    rootOwnAudit.record(path);
    return `${tenantContext.id}:${path}`;
  },
});
