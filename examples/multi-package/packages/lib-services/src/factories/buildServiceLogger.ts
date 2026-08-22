import type { Logger } from "../types/Logger.js";
import type { ServiceLogger } from "../types/ServiceLogger.js";

type ServiceLoggerDeps = {
  /**
   * External: the composing app registers it. `logger` is not a registration key or a contract slot
   * key in this package, so it stays in `IocExternals` and the app is asked for it.
   */
  logger: Logger;
};

/** Adapts the external logger for upload and other services (not in `groups.loggers`). */
export const buildServiceLogger = ({
  logger,
}: ServiceLoggerDeps): ServiceLogger => logger;
