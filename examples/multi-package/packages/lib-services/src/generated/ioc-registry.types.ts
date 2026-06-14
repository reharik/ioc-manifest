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

/**
 * Values supplied at runtime by registering onto a request child scope
 * (e.g. `scope.register({ key: asValue(...) })`) — not built by any factory.
 *
 * Register the relevant key(s) onto the child scope before resolving services that
 * depend on them. Resolving a dependent service without the value throws at runtime
 * (`IocResolutionError`), never returns a placeholder.
 *
 * Not every key is needed on every scope — register only those the current request
 * path actually resolves (e.g. an authed path vs. a public path).
 */
export interface IocScopeProvided {
  viewerId: string;
}
