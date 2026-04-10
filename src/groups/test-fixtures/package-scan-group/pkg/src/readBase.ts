/** Base type for package-scan group integration (lives in workspace package scan root). */
export interface PkgReadBase {
  readonly kind: "read";
}

export interface AlbumLike extends PkgReadBase {
  album(): void;
}
