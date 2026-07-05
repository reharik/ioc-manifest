import type {
  AlbumEvent,
  PublicReadServiceBase,
  StandaloneService,
  SweepStrategy,
} from "./contracts.js";

// Two implementations of the group-only base, neither elected default.
export const buildAlbumRead = (): PublicReadServiceBase => ({
  read: () => "album",
});

export const buildPhotoRead = (): PublicReadServiceBase => ({
  read: () => "photo",
});

// A normal single registration (regression control).
export const buildStandaloneService = (): StandaloneService => ({
  run: () => {},
});

// Single impl of a generic base, registered under a non-convention key so the bare
// `sweepStrategy: SweepStrategy` contract-default singular is what would otherwise emit (TS2314).
export const buildFastSweep = (): SweepStrategy<AlbumEvent> => ({
  sweep: () => {},
});
