import type { RequestTracingLogger } from "../types/RequestTracingLogger.js";

export const buildRequestTracingLogger = (): RequestTracingLogger => ({
  __iocLifetimeScoped: true,
  id: "requestTracingLogger",
  ping: () => "request-trace",
});
