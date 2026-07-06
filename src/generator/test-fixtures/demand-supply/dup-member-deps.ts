import type { DupCradle as CradleA } from "./dup-cradle-a.js";
import type { DupCradle as CradleB } from "./dup-cradle-b.js";

// Two distinct nominal `DupCradle` types (different files) that render to the same name — the
// compound-emission shape that previously produced `DupCradle & DupCradle`.
type DupDeps = {
  repeated: CradleA & CradleB;
  // Genuine multi-member intersection: distinct members must be preserved, not collapsed.
  distinct: CradleA & { readonly extra: number };
};

export const buildDup = (_deps: DupDeps): void => {};
