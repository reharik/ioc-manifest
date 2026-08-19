/**
 * A scope root whose subtree resolves a GROUP root key.
 *
 * Generation expands `auditLogsGroup` through the group plan. Inspection has no group plan, so the
 * key would otherwise read as an unsatisfied scope-demand — a failure generation does not have.
 */
import type { ScopeRoot } from "../../../scopeRoots/scopeRoot.js";
import type { IAuditLog, IRequestRouter } from "./deps-contracts.js";

export const buildConsoleAudit = (): IAuditLog => ({
  record: (event: string) => {
    void event;
  },
});

export const buildFileAudit = (): IAuditLog => ({
  record: (event: string) => {
    void event;
  },
});

type GroupedRouterDeps = { auditLogsGroup: readonly IAuditLog[] };

/** Declares an empty lbv set: the group key is container-supplied, not a late-bound value. */
export const buildGroupedRouter = ({
  auditLogsGroup,
}: GroupedRouterDeps): ScopeRoot<IRequestRouter, Record<string, never>> => ({
  handle: (path: string) => {
    for (const audit of auditLogsGroup) {
      audit.record(path);
    }
    return path;
  },
});
