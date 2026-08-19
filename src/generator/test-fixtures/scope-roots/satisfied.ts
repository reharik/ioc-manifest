/**
 * A scope root whose declared lbv set exactly covers its subtree's scope-demands.
 *
 * The subtree is two levels deep on purpose: `requestRouter → auditLog → clock` and
 * `requestRouter → sessionStore`, so the walk has to descend past its own direct deps to find
 * `viewerId` and `uow`.
 */
import type { ScopeRoot } from "../../../scopeRoots/scopeRoot.js";
import type {
  IAuditLog,
  IClock,
  IRequestRouter,
  ISessionStore,
  UnitOfWork,
  ViewerId,
} from "./deps-contracts.js";

export const buildClock = (): IClock => ({ now: () => 0 });

type AuditLogDeps = { clock: IClock; viewerId: ViewerId };

/** Demands a late-bound value two levels under the root. */
export const buildAuditLog = ({
  clock,
  viewerId,
}: AuditLogDeps): IAuditLog => ({
  record: (event: string) => {
    void `${clock.now()}:${viewerId}:${event}`;
  },
});

type SessionStoreDeps = { uow: UnitOfWork };

export const buildSessionStore = ({ uow }: SessionStoreDeps): ISessionStore => ({
  get: (id: string) => {
    void uow;
    return id;
  },
});

type RequestRouterDeps = { auditLog: IAuditLog; sessionStore: ISessionStore };

/** Declares both late-bound values its subtree resolves — nothing missing, nothing spare. */
export const buildRequestRouter = ({
  auditLog,
  sessionStore,
}: RequestRouterDeps): ScopeRoot<
  IRequestRouter,
  { viewerId: ViewerId; uow: UnitOfWork }
> => ({
  handle: (path: string) => {
    auditLog.record(path);
    return sessionStore.get(path) ?? path;
  },
});
