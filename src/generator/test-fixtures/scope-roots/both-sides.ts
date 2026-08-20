/**
 * One contract declared BOTH as a scope root and as an ordinary registration — the split-brain
 * contract stage 3 turns into a hard error.
 *
 * Allowing it would make `deps: { plainRouter: IRequestRouter }` legal while
 * `deps: { scopedRouter: IRequestRouter }` is not, for reasons invisible at the interface.
 */
import type { ScopeRoot } from "../../../scopeRoots/scopeRoot.js";
import type { IRequestRouter } from "./deps-contracts.js";

/** An ordinary implementation of the contract: claims a cradle key, elects a default. */
export const buildPlainRouter = (): IRequestRouter => ({
  handle: (path: string) => path,
});

/** A scope root of the same contract: opener-only, claims no cradle key. */
export const buildScopedRouter = (): ScopeRoot<
  IRequestRouter,
  Record<string, never>
> => ({
  handle: (path: string) => path,
});
