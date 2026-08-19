import type { ScopeRoot } from "../../../scopeRoots/scopeRoot.js";
import type { Clock, IRouter, UnitOfWork, ViewerId } from "./contracts.js";

const router = (label: string): IRouter => ({
  handle: (path: string) => `${label}:${path}`,
});

/**
 * Variant one of the `IRouter` scope root: an authenticated request boundary. The declared lbv set
 * names the values that enter at that boundary.
 */
export const buildAuthRouter = (): ScopeRoot<IRouter, { viewerId: string }> =>
  router("auth");

/**
 * Variant two of the same scope root: a public-link request boundary. Same root contract, different
 * late-bound values — the variant is the factory identity, never a type parameter.
 */
export const buildPublicRouter = (): ScopeRoot<
  IRouter,
  { publicLinkId: string }
> => router("public");

/** An ordinary factory alongside the scope roots: unaffected by the marker. */
export const buildSystemClock = (): Clock => ({ now: () => 0 });

/**
 * A third variant, written async and with named types in the lbv set: pins that `Promise` and the
 * marker compose, and that the lbv type argument is captured verbatim without being resolved.
 */
export const buildWorkerRouter = async (): Promise<
  ScopeRoot<IRouter, { viewerId: ViewerId; uow: UnitOfWork }>
> => router("worker");
