/* AUTO-GENERATED. DO NOT EDIT.
Re-run `npm run gen:manifest` after changing factories or IoC config.
*/
import type { Storage } from "../types/Storage.js";
import type { LoggingService } from "@example/lib-contracts/types/LoggingService.js";

export interface IocGeneratedCradle {
  archiveStorage: Storage;
  localStorage: Storage;
  loggers: ReadonlyArray<LoggingService>;
  s3Storage: Storage;
  storage: Storage;
}

export type Loggers = ReadonlyArray<LoggingService>;

export interface IocExternals {}

export interface IocScopeProvided {}
