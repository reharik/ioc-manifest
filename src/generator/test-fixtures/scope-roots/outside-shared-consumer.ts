/**
 * An ordinary factory, outside every scope-root subtree, depending on the unit that demands the key.
 *
 * `taggedAudit` is now reachable two ways: under the declaring variant's scope, where the opener
 * supplies `auditContext`, and from here, where the root container must. "Inside" has no single
 * answer for it, so it counts as an outside demand — conservatively, and recorded as a shared unit.
 */
import type { IAuditLog, IClock } from "./deps-contracts.js";

type SharedConsumerDeps = { taggedAudit: IAuditLog };

export const buildSharedConsumer = ({
  taggedAudit,
}: SharedConsumerDeps): IClock => ({
  now: () => {
    taggedAudit.record("tick");
    return 0;
  },
});
