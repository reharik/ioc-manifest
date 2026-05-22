import type { Logger } from "../types/Logger.js";
import type { LoggingService } from "../types/LoggingService.js";

type LoggingServiceDeps = {
  logger: Logger;
};

export const buildLoggingService = ({
  logger,
}: LoggingServiceDeps): LoggingService => ({
  ping: () => logger.log("ping"),
});
