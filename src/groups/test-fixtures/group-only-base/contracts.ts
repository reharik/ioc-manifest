/** Group-only base: extended/implemented by several members, injected only as the group. */
export interface PublicReadServiceBase {
  read: () => string;
}

/** A normal single registration (regression: must keep its singular contract-default key). */
export interface StandaloneService {
  run: () => void;
}

export interface EventShape {
  kind: string;
}
export interface AlbumEvent extends EventShape {
  kind: "album";
}

/** Generic group-only base with a required type parameter. */
export interface SweepStrategy<T extends EventShape> {
  sweep: (event: T) => void;
}
