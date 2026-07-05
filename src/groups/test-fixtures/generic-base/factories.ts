import type {
  AlbumStrategy,
  PhotoStrategy,
  Plain,
  VideoStrategy,
} from "./contracts.js";

export const buildAlbumStrategy = (): AlbumStrategy => ({
  handle: () => {},
});

export const buildPhotoStrategy = (): PhotoStrategy => ({
  handle: () => {},
});

export const buildVideoStrategy = (): VideoStrategy => ({
  handle: () => {},
});

export const buildPlain = (): Plain => ({
  ping: () => {},
});
