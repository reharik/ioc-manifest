export interface EntityId {
  readonly id: string;
}

export type User = {
  name: string;
};

export type AppCradle = {
  app: string;
};

// Named member (`AppCradle`) intersected with an anonymous object literal. The anonymous member
// has no importable name — its compiler symbol is `__type`. Declared HERE, in a file separate
// from the consuming factory, so the anonymous member's declaration source is NOT the factory's
// context file: the exact shape that previously emitted `import type { __type }` (TS2305).
export type MixedCradle = AppCradle & {
  viewerId: EntityId;
  viewer: User;
};
