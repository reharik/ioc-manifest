import type { Logger, NonDestructured } from "./contracts.js";

type NonDestructuredDeps = { logger: Logger };

/**
 * `(deps: Deps)` — the shape found in the wild (a consumer repo's `mediaServeController`), and the
 * reason this diagnostic exists. It runs; it just says nothing about what it demands.
 */
export const buildNonDestructured = (
  deps: NonDestructuredDeps,
): NonDestructured => ({
  run: () => deps.logger.log("x"),
});
