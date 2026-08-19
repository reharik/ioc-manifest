/**
 * Keys demanded by the scope-root unit ITSELF, not by anything under it.
 *
 * This is the position with no backstop anywhere else in the tool. Scope roots are excluded from
 * `acceptedFactories`, so `analyzeDemandSupply` never walks them: `tenantId` reaches neither the
 * externals set nor the emitted `Externals` interface, and composition therefore never checks it.
 * A subtree key in the same position at least fails loudly at composition; this one would resolve
 * to `undefined` at runtime with nothing having complained.
 *
 * Both variants demand `tenantId` identically. Only the declaration differs.
 */
import type { ScopeRoot } from "../../../scopeRoots/scopeRoot.js";
import type {
  IAuditLog,
  IRequestRouter,
  TenantId,
} from "./deps-contracts.js";

export const buildAuditLog = (): IAuditLog => ({
  record: (event: string) => {
    void event;
  },
});

type RootOwnDeps = { auditLog: IAuditLog; tenantId: TenantId };

/** Declares nothing. `tenantId` is registered nowhere and named nowhere — the hole. */
export const buildUndeclaredRootRouter = ({
  auditLog,
  tenantId,
}: RootOwnDeps): ScopeRoot<IRequestRouter, Record<string, never>> => ({
  handle: (path: string) => {
    auditLog.record(path);
    return `${tenantId}:${path}`;
  },
});

/** Same demand, declared. The boundary carries it, and the check is satisfied. */
export const buildDeclaredRootRouter = ({
  auditLog,
  tenantId,
}: RootOwnDeps): ScopeRoot<IRequestRouter, { tenantId: TenantId }> => ({
  handle: (path: string) => {
    auditLog.record(path);
    return `${tenantId}:${path}`;
  },
});
