import type { AlbumLike } from "../../../pkg/src/readBase.js";

export const buildAlbumLike = (): AlbumLike => ({
  kind: "read",
  album: () => {},
});
