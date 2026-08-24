/* AUTO-GENERATED. DO NOT EDIT.
Re-run `npm run gen:manifest` after changing factories or IoC config.
*/
import type { Storage } from "../types/Storage.js";
import type { AddComment, ToggleReaction } from "../types/WriteServices.js";
import type { LoggingService } from "@example/lib-contracts/types/LoggingService.js";

export interface IocGeneratedCradle {
  archiveStorage: Storage;
  localStorage: Storage;
  loggers: ReadonlyArray<LoggingService>;
  s3Storage: Storage;
  storage: Storage;
  writeServices: {
    addComment: AddComment;
    toggleReaction: ToggleReaction;
  };
}

export type Loggers = ReadonlyArray<LoggingService>;

export type WriteServices = {
  addComment: AddComment;
  toggleReaction: ToggleReaction;
};

export interface IocExternals {}

export interface IocScopeProvided {}
