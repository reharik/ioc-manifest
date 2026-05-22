/* AUTO-GENERATED. DO NOT EDIT.
Re-run `npm run gen:manifest` after changing factories or IoC config.
*/
import type { Logger } from "../examples/a-single-implementation.js";
import type { MediaStorage } from "../examples/b-multiple-implementations.js";
import type { Widget } from "../examples/c-default-selection.js";
import type { CacheClient } from "../examples/d-grouping.js";
import type { AlbumService } from "../examples/f-dependency-injection.js";

export interface IocGeneratedCradle {
  albumService: AlbumService;
  cacheClient: CacheClient;
  consoleLogger: Logger;
  localMediaStorage: MediaStorage;
  logger: Logger;
  mediaStorage: MediaStorage;
  mediaStorages: ReadonlyArray<MediaStorage>;
  mediaStoragesGroup: ReadonlyArray<MediaStorage>;
  memoryCache: CacheClient;
  primaryWidget: Widget;
  s3MediaStorage: MediaStorage;
  secondaryWidget: Widget;
  widget: Widget;
  widgets: ReadonlyArray<Widget>;
}

export interface IocExternals {}
