import type {
  AlbumService,
  MediaStorage,
  SpecialAlbumService,
  UnrelatedContract,
} from "./contracts.js";

export const buildAlbumService = (): AlbumService => ({
  kind: "read",
  album: () => {},
});

export const buildSpecialAlbumService = (): SpecialAlbumService => ({
  kind: "read",
  album: () => {},
  special: () => {},
});

export const buildMediaStorage = (): MediaStorage => ({
  kind: "read",
  media: () => {},
});

export const buildUnrelatedContract = (): UnrelatedContract => ({ n: 0 });
