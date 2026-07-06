import type { MixedCradle } from "./anon-intersection-contracts.js";

type AnonDeps = {
  // Property typed as the cross-file named-&-anonymous intersection. Emitting this must inline the
  // anonymous member structurally (importing its field types) while importing only the named member.
  ctx: MixedCradle;
};

export const buildAnon = (_deps: AnonDeps): void => {};
