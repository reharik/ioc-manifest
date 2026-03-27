import type { MediaStorage } from "./b-multiple-implementations.js";
export type AlbumService = {
    describe: () => string;
};
type AlbumDeps = {
    mediaStorage: MediaStorage;
};
export declare const buildAlbumService: ({ mediaStorage }: AlbumDeps) => AlbumService;
export {};
//# sourceMappingURL=f-dependency-injection.d.ts.map