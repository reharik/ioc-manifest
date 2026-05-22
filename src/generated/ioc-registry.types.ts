/* AUTO-GENERATED. DO NOT EDIT.
Re-run `npm run gen:manifest` after changing factories or IoC config.
*/
import type { Logger } from "../examples/a-single-implementation.js";
import type { MediaStorage } from "../examples/b-multiple-implementations.js";
import type { Widget } from "../examples/c-default-selection.js";
import type { CacheClient } from "../examples/d-grouping.js";
import type { AlbumService } from "../examples/f-dependency-injection.js";

export interface IocGeneratedCradle {
  albumService: AlbumService; // locally supplied
  cacheClient: CacheClient; // locally supplied
  consoleLogger: Logger; // locally supplied
  localMediaStorage: MediaStorage; // locally supplied
  logger: Logger; // locally supplied
  mediaStorage: MediaStorage; // locally supplied
  mediaStorages: ReadonlyArray<MediaStorage>; // locally supplied
  mediaStoragesGroup: ReadonlyArray<MediaStorage>; // locally supplied
  memoryCache: CacheClient; // locally supplied
  primaryWidget: Widget; // locally supplied
  s3MediaStorage: MediaStorage; // locally supplied
  secondaryWidget: Widget; // locally supplied
  widget: Widget; // locally supplied
  widgets: ReadonlyArray<Widget>; // locally supplied
}

export interface IocExternals {}
