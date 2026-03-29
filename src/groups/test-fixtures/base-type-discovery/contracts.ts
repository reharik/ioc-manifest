/** Base type used only as a discovery filter in group tests. */
export interface ReadService {
  readonly kind: "read";
}

export interface AlbumService extends ReadService {
  album(): void;
}

export interface SpecialAlbumService extends AlbumService {
  special(): void;
}

export interface MediaStorage extends ReadService {
  media(): void;
}

export interface UnrelatedContract {
  readonly n: number;
}

/** Declared only — no factory return type; used to test discovery with zero matches. */
export interface NoMatchingContracts {
  readonly __noMatchingContractsBrand: "NoMatchingContracts";
}
