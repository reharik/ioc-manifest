import type { Named } from "../../../named/named.js";
import type { RequestPipeline, SlotRouter } from "./scope-root-reexports.js";

/**
 * The marker on a scope-root OPENER key. An opener is emitted by generation, not registered by an
 * implementation, so "that specific implementation" cannot be said about it.
 */
type MarkedOpenerDeps = { openSlotRouterScope: Named<SlotRouter> };

export const buildMarkedOpenerPipeline = ({
  openSlotRouterScope,
}: MarkedOpenerDeps): RequestPipeline => ({
  run: () => String(openSlotRouterScope),
});
