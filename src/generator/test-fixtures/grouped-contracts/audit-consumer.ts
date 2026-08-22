import type { AuditConsumer } from "./contracts.js";
import type { AuditChannels } from "./generated/ioc-registry.types.js";

/**
 * A singleton consuming a SCOPED group.
 *
 * The inversion is real and reached through the group HOP: `auditChannels` is a walk hop rather
 * than a unit, so the check has to expand it to its members and rank each. A singleton freezing a
 * per-scope channel is the same defect whether it names the member or the family.
 */
type AuditConsumerDeps = { auditChannels: AuditChannels };

export const buildAuditConsumer = ({
  auditChannels,
}: AuditConsumerDeps): AuditConsumer => ({
  run: () => auditChannels.map((c) => c.write("x")).join(","),
});
