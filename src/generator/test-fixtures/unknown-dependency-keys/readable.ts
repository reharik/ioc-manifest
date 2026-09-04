import type { Logger, Readable } from "./contracts.js";

type ReadableDeps = { logger: Logger };

/** The control: a destructured parameter, fully readable, and never reported. */
export const buildReadable = ({ logger }: ReadableDeps): Readable => ({
  run: () => logger.log("ok"),
});
