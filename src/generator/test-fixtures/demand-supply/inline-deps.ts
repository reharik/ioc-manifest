import type { Logger } from "./contracts.js";

export const buildInline = ({
  logger,
}: {
  logger: Logger;
}): Logger => logger;
