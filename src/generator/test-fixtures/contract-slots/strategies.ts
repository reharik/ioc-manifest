import type { Strategy } from "./contracts.js";

/**
 * Two implementations of a GROUP BASE with no `default: true` on either: the contract elects no
 * default, so it has no slot key at all. Kept in its own file so the no-election case can be
 * generated without the elected `AuthMiddleware` set.
 */
export const buildFastStrategy = (): Strategy => ({ id: "fast" });

export const buildSlowStrategy = (): Strategy => ({ id: "slow" });
