import type { LoggingService } from "../types/LoggingService.js";

export const buildRequestTracingLogger = (): LoggingService => ({
  id: "requestTracingLogger",
  ping: () => "request-trace",
});
