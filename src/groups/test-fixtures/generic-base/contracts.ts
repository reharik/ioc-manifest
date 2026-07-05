export type SharedEventName =
  | "album.shared"
  | "photo.shared"
  | "video.shared";

/** Homogeneous declared arg: a single-literal alias the checker can resolve. */
export type AlbumOnly = "album.shared";

/** Generic base with a REQUIRED (non-defaulted) type parameter. */
export interface Strategy<TInput extends SharedEventName> {
  handle: (input: TInput) => void;
}

export type AlbumStrategy = Strategy<"album.shared">;
export type PhotoStrategy = Strategy<"photo.shared">;
export type VideoStrategy = Strategy<"video.shared">;

/** Non-generic base — declaring a baseTypeArg over it is a config error. */
export interface Plain {
  ping: () => void;
}
