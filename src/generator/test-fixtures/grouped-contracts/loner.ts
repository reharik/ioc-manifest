import type { ScopedLoner } from "./contracts.js";

/** Ruling 3: a marker confers a lifetime and never a group. This contract joins nothing. */
export const buildScopedLoner = (): ScopedLoner => ({ id: () => "loner" });
