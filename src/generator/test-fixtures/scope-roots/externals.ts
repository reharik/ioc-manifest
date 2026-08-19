/**
 * A scope root whose subtree consumes an EXTERNAL and a genuine late-bound value side by side.
 *
 * `db` is container-constant: the composing app registers it on the root container and the
 * externals-satisfaction check verifies it at composition. It is not a late-bound value, so it must
 * not be required in any variant's lbv — a scope can be re-mounted under a different parent scope,
 * but can never be transported away from its root container.
 *
 * `viewerId` is declared `scopeProvided` by the fixtures' config, so it enters at the boundary and
 * the declaration has to carry it.
 */
import type { ScopeRoot } from "../../../scopeRoots/scopeRoot.js";
import type {
  IAuditLog,
  IRequestRouter,
  ISessionStore,
  ViewerId,
} from "./deps-contracts.js";

/** Not built by any factory here: the app supplies it on the root container. */
export interface DbHandle {
  query: (sql: string) => Promise<unknown>;
}

type SessionStoreDeps = { db: DbHandle };

/** Consumes an external only. Nothing about it belongs in a scope-root declaration. */
export const buildSessionStore = ({ db }: SessionStoreDeps): ISessionStore => ({
  get: (id: string) => {
    void db;
    return id;
  },
});

type AuditLogDeps = { db: DbHandle; viewerId: ViewerId };

/** Consumes the same external plus a real late-bound value. */
export const buildAuditLog = ({ db, viewerId }: AuditLogDeps): IAuditLog => ({
  record: (event: string) => {
    void `${String(db)}:${viewerId}:${event}`;
  },
});

type ExternalOnlyRouterDeps = { sessionStore: ISessionStore };

/**
 * Declares an EMPTY lbv set and is satisfied: everything its subtree resolves is either a manifest
 * registration or an external.
 */
export const buildExternalOnlyRouter = ({
  sessionStore,
}: ExternalOnlyRouterDeps): ScopeRoot<
  IRequestRouter,
  Record<string, never>
> => ({
  handle: (path: string) => sessionStore.get(path) ?? path,
});

type MixedRouterDeps = { auditLog: IAuditLog; sessionStore: ISessionStore };

/**
 * Reaches the same external AND a real scope-demand it fails to declare. Only the scope-demand may
 * fail; the external must stay silent.
 */
export const buildMixedRouter = ({
  auditLog,
  sessionStore,
}: MixedRouterDeps): ScopeRoot<IRequestRouter, Record<string, never>> => ({
  handle: (path: string) => {
    auditLog.record(path);
    return sessionStore.get(path) ?? path;
  },
});
