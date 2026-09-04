import type { Logger, RestElement } from "./contracts.js";

type RestElementDeps = { logger: Logger; other: Logger };

/**
 * The idiomatic-looking one. It names `logger` and then discards that name along with everything
 * else, because `rest` may be read for any key at all and the pattern can no longer be trusted as
 * the whole demand set.
 */
export const buildRestElement = ({
  logger,
  ...rest
}: RestElementDeps): RestElement => ({
  run: () => {
    logger.log("x");
    rest.other.log("y");
  },
});
