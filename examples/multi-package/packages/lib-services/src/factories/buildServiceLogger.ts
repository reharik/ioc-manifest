import type { Logger } from "../types/Logger.js";

type ServiceLoggerDeps = {
  logger: Logger;
};

/** Adapts the external logger for upload and other services (not in `groups.loggers`). */
export const buildServiceLogger = ({ logger }: ServiceLoggerDeps): Logger => logger;
