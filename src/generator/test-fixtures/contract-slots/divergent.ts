import type { AuditSink } from "./contracts.js";

/**
 * A single-implementation contract whose registration key diverges from its contract key:
 * `onlyAuditSink` (from the export name) vs `auditSink` (from the contract name).
 *
 * Both names are real and they mean different things now — the slot follows the election, the
 * implementation key names this unit — which is why the divergent-name advisory was retired.
 */
export const buildOnlyAuditSink = (): AuditSink => ({
  write: () => {
    /* noop */
  },
});
