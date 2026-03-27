import type { Logger } from "../examples/a-single-implementation.js";
import type { MediaStorage } from "../examples/b-multiple-implementations.js";
import type { Widget } from "../examples/c-default-selection.js";
import type { CacheClient } from "../examples/d-grouping.js";
import type { AlbumService } from "../examples/f-dependency-injection.js";
export interface IocGeneratedTypes {
    albumService: AlbumService;
    cacheClient: CacheClient;
    memoryCache: CacheClient;
    logger: Logger;
    consoleLogger: Logger;
    mediaStorage: MediaStorage;
    localMediaStorage: MediaStorage;
    s3MediaStorage: MediaStorage;
    mediaStorages: Record<"localMediaStorage" | "mediaStorage" | "s3MediaStorage", MediaStorage>;
    widget: Widget;
    primaryWidget: Widget;
    secondaryWidget: Widget;
    widgets: Record<"primaryWidget" | "secondaryWidget", Widget>;
    services: {
        album: ReadonlyArray<AlbumService>;
        media: {
            read: ReadonlyArray<MediaStorage>;
        };
        read: ReadonlyArray<AlbumService | MediaStorage>;
    };
}
export type IocGeneratedCradle = IocGeneratedTypes;
//# sourceMappingURL=ioc-registry.types.d.ts.map