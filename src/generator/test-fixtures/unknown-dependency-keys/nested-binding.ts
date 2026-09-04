import type { Logger, NestedBinding } from "./contracts.js";

type NestedBindingDeps = { logger: Logger };

/** Binds a property OF a dependency, so no name in the pattern is a cradle key. */
export const buildNestedBinding = ({
  logger: { log },
}: NestedBindingDeps): NestedBinding => ({
  run: () => log("x"),
});
