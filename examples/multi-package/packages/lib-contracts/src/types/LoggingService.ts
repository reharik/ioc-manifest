import type { IScoped } from "./IScoped.js";

/**
 * Shared base type for the cross-package `loggers` collection group (§8).
 *
 * It carries the `IScoped` lifetime marker, and that is the ONLY place the family's lifetime may be
 * declared: every member ranks scoped by inheriting it, with provenance `group-base-marker`. A
 * member declaring its own marker — or a per-implementation `lifetime` override in `ioc.config` —
 * is a hard error, because it is a claim of authority over a property of the family it does not own.
 */
export interface LoggingService extends IScoped {
  readonly id: string;
  ping: () => string;
}
