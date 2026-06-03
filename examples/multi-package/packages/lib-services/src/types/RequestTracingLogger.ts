import type { LoggingService } from "@example/lib-contracts/types/LoggingService.js";
import type { IScoped } from "./IScoped.js";

export interface RequestTracingLogger extends LoggingService, IScoped {
  readonly __iocLifetimeScoped: true;
}
