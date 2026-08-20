/**
 * An ordinary factory whose registration key is exactly the key a scope root's opener would claim.
 *
 * `buildOpenCollidingRouterScope` derives the key `openCollidingRouterScope`; the variant
 * `collidingRouter` derives the same key for its opener. An opener is an ordinary cradle
 * registration, so this is a key collision like any other and belongs to the same machinery.
 */
import type { ScopeRoot } from "../../../scopeRoots/scopeRoot.js";
import type { IClock, IRequestRouter } from "./deps-contracts.js";

export const buildOpenCollidingRouterScope = (): IClock => ({ now: () => 0 });

export const buildCollidingRouter = (): ScopeRoot<
  IRequestRouter,
  Record<string, never>
> => ({
  handle: (path: string) => path,
});
