/* AUTO-GENERATED. DO NOT EDIT.
Re-run `npm run gen:manifest` after changing factories or IoC config.
*/
import type { Logger } from "../types/Logger.js";
import type { RequestTracingLogger } from "../types/RequestTracingLogger.js";
import type { UploadService } from "../types/UploadService.js";
import type { ViewerReadService } from "../types/ViewerReadService.js";
import type { Storage } from "@example/lib-storage";

export interface IocGeneratedCradle {
  loggers: ReadonlyArray<RequestTracingLogger>;
  requestTracingLogger: RequestTracingLogger;
  serviceLogger: Logger;
  uploadService: UploadService;
  viewerReadService: ViewerReadService;
}

export interface IocExternals {
  logger: Logger;
  storage: Storage;
}

export interface IocScopeProvided {
  viewerId: string;
}
