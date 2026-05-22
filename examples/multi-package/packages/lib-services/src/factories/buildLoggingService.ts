import type { LoggingService } from "@example/lib-contracts/types/LoggingService.js";
import type { Logger } from "../types/Logger.js";

type LoggingServiceDeps = {
  logger: Logger;
};

export const buildLoggingService = ({
  logger,
}: LoggingServiceDeps): LoggingService => ({
  id: "loggingService",
  ping: () => logger.log("ping"),
});
