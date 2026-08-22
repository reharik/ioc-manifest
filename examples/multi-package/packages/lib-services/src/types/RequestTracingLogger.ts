import type { IScoped } from "@example/lib-contracts/types/IScoped.js";

/**
 * A scoped contract that is NOT a group member.
 *
 * Ruling 3, the orthogonality half: a `lifetimeMarkers` interface never induces group membership —
 * grouping is decided only by `config.groups` base types. This contract extends `IScoped` and joins
 * nothing, so it keeps its own cradle key and the app resolves it per scope.
 *
 * It used to also extend `LoggingService`, which made it a `loggers` member carrying its own
 * marker — now a hard error, since lifetime belongs to the group base. Leaving the group is one of
 * the two fixes the error names; the other is moving the marker to the base.
 */
export interface RequestTracingLogger extends IScoped {
  readonly id: string;
  ping: () => string;
}
