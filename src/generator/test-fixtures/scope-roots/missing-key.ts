/**
 * A scope root whose subtree demands a key the declaration omits — the stage-2 error case — and
 * which simultaneously declares a key nothing under the root demands — the warning case.
 *
 * `viewerId` is the classic shape of the failure the diagnostics must anticipate: the developer
 * knows an enclosing scope supplies it, so the error has to say declarations are per-root and
 * complete rather than reading as a tool bug.
 */
import type { ScopeRoot } from "../../../scopeRoots/scopeRoot.js";
import type {
  IAuditLog,
  IRequestRouter,
  ViewerId,
} from "./deps-contracts.js";

type AuditLogDeps = { viewerId: ViewerId };

export const buildAuditLog = ({ viewerId }: AuditLogDeps): IAuditLog => ({
  record: (event: string) => {
    void `${viewerId}:${event}`;
  },
});

type PublicRouterDeps = { auditLog: IAuditLog };

/** Declares `publicLinkId` (nothing demands it) and omits `viewerId` (the subtree demands it). */
export const buildPublicRouter = ({
  auditLog,
}: PublicRouterDeps): ScopeRoot<IRequestRouter, { publicLinkId: string }> => ({
  handle: (path: string) => {
    auditLog.record(path);
    return path;
  },
});
