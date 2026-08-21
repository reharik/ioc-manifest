import type {
  AppCradle,
  EntityId,
  MixedCradle,
  User,
} from "./anon-intersection-contracts.js";

type AnonDeps = {
  // Property typed as the cross-file named-&-anonymous intersection. An exported alias NAMES this
  // intersection, so it is emitted by reference to that name — the structure is never expanded.
  ctx: MixedCradle;
  // The same shape with nothing naming it. No alias means no reference to emit, so this is the one
  // path that still prints structure: the anonymous member is inlined (emitting `import type
  // { __type }` would be TS2305) while its named field types are imported.
  inlineCtx: AppCradle & { viewerId: EntityId; viewer: User };
};

export const buildAnon = (_deps: AnonDeps): void => {};
