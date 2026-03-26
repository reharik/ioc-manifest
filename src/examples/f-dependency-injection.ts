import type { MediaStorage } from "./b-multiple-implementations.js";

export type AlbumService = {
  describe: () => string;
};

type AlbumDeps = {
  mediaStorage: MediaStorage;
};

export const buildAlbumService = ({ mediaStorage }: AlbumDeps): AlbumService => {
  return {
    describe: () => `albums backed by ${mediaStorage.label}`,
  };
};
