import type { LoggingService } from "@example/lib-contracts/types/LoggingService.js";

/**
 * A second `loggers` member. Like its sibling it claims NO cradle key: a collection group's members
 * are individually anonymous by declaration, and `loggers` is how either of them is reached.
 *
 * It ranks scoped, and nothing here says so — the marker is on `LoggingService`, the group base.
 */
export const buildAuditEventLogger = (): LoggingService => ({
  id: "auditEventLogger",
  ping: () => "audit-event",
});
