import type { Defaulted, Logger } from "./contracts.js";

type DefaultedDeps = { logger: Logger };

const NO_LOGGER: DefaultedDeps = { logger: { log: () => undefined } };

/** Non-destructured AND defaulted. Removing the default would not help; destructuring would. */
export const buildDefaulted = (deps: DefaultedDeps = NO_LOGGER): Defaulted => ({
  run: () => deps.logger.log("x"),
});
