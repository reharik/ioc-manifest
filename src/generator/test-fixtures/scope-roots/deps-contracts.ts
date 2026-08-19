/**
 * Contracts for the stage-2 (demand–supply verification) scope-root fixtures.
 *
 * Kept apart from `contracts.ts` so the stage-1 discovery fixtures stay exactly as they were.
 */

export interface IRequestRouter {
  handle: (path: string) => string;
}

export interface IAuditLog {
  record: (event: string) => void;
}

export interface ISessionStore {
  get: (id: string) => string | undefined;
}

export interface IClock {
  now: () => number;
}

export type ViewerId = string & { readonly __viewer?: unique symbol };

export type TenantId = string & { readonly __tenant?: unique symbol };

export interface UnitOfWork {
  commit: () => Promise<void>;
}

/** Widest of the pair — used to pin the assignability DIRECTION of the lbv check. */
export interface Principal {
  id: string;
}

/** Strictly narrower than {@link Principal}: `AdminPrincipal extends Principal`, never the inverse. */
export interface AdminPrincipal extends Principal {
  role: "admin";
}
