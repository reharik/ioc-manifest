/* AUTO-GENERATED. DO NOT EDIT.
Re-run `npm run gen:manifest` after changing factories or IoC config.
*/
import type { Logger } from "../examples/a-single-implementation.js";
import type { MediaStorage } from "../examples/b-multiple-implementations.js";
import type { Widget } from "../examples/c-default-selection.js";
import type { CacheClient } from "../examples/d-grouping.js";
import type { AlbumService } from "../examples/f-dependency-injection.js";

export interface IocGeneratedTypes {
  albumService: AlbumService;
  cacheClient: CacheClient;
  logger: Logger;
  mediaStorage: MediaStorage;
  mediaStorages: Record<
    "localMediaStorage" | "mediaStorage" | "s3MediaStorage",
    MediaStorage
  >;
  widget: Widget;
  widgets: Record<"primaryWidget" | "secondaryWidget", Widget>;
  mediaStoragesGroup: ReadonlyArray<MediaStorage>;
}

export type IocGeneratedCradle = IocGeneratedTypes;
