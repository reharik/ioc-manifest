/**
 * A scope root whose subtree crosses a CONTRACT SLOT key edge.
 *
 * `buildSlotRouter` demands `authMiddleware` — the slot, not a registration key — and the elected
 * implementation `optionalAuthMiddleware` demands `requestTag` in turn. The walk only reaches
 * `requestTag` if a slot-key edge resolves through the election and descends; with the edge missing,
 * the key looks like a container constant and the variant reads satisfied on a subtree it never saw.
 */
import type { ScopeRoot } from "../../../scopeRoots/scopeRoot.js";
import type { AuthMiddleware } from "./contracts.js";

/** Late-bound at the boundary, demanded one level below the slot-key edge. */
export interface RequestTag {
  value: string;
}

/** What the scope root resolves to. */
export interface SlotRouter {
  handle: (path: string) => string;
}

type TaggingAuthMiddlewareDeps = { requestTag: RequestTag };

/** The elected `AuthMiddleware` for this fixture set, and the unit the slot-key edge lands on. */
export const buildTaggingAuthMiddleware = ({
  requestTag,
}: TaggingAuthMiddlewareDeps): AuthMiddleware => ({
  name: "tagging",
  handle: (path: string) => `${requestTag.value}:${path}`,
});

type SlotRouterDeps = { authMiddleware: AuthMiddleware };

export const buildSlotRouter = ({
  authMiddleware,
}: SlotRouterDeps): ScopeRoot<SlotRouter, { requestTag: RequestTag }> => ({
  handle: (path: string) => authMiddleware.handle(path),
});
