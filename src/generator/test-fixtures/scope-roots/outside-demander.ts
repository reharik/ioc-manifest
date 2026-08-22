/**
 * The base of the outside-demander fixture set: one variant declaring `auditContext`, and the one
 * unit under it that demands the key.
 *
 * Alone, every demand of `auditContext` sits inside the declaring variant's subtree, so the
 * declaration speaks for the whole story and the key is excluded from `Externals`. The two sibling
 * fixtures each add exactly one outside demander; the difference in emitted output between this
 * file alone and this file plus one of them IS the predicate.
 */
import type { Named } from "../../../named/named.js";
import type { ScopeRoot } from "../../../scopeRoots/scopeRoot.js";
import type { IAuditLog, IRequestRouter } from "./deps-contracts.js";

/** Per-open for the declaring variant; a container constant for anything outside it. */
export interface AuditContext {
  id: string;
}

type TaggedAuditDeps = { auditContext: AuditContext };

/** The only demander of `auditContext` in the base fixture. */
export const buildTaggedAudit = ({
  auditContext,
}: TaggedAuditDeps): IAuditLog => ({
  record: (event: string) => {
    void `${auditContext.id}:${event}`;
  },
});

type ScopedRouterDeps = { taggedAudit: Named<IAuditLog> };

export const buildScopedRouter = ({
  taggedAudit,
}: ScopedRouterDeps): ScopeRoot<
  IRequestRouter,
  { auditContext: AuditContext }
> => ({
  handle: (path: string) => {
    taggedAudit.record(path);
    return path;
  },
});
