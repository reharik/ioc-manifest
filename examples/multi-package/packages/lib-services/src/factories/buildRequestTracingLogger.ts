import type { RequestTracingLogger } from "../types/RequestTracingLogger.js";

export const buildRequestTracingLogger = (): RequestTracingLogger => ({
  id: "requestTracingLogger",
  ping: () => "request-trace",
});
