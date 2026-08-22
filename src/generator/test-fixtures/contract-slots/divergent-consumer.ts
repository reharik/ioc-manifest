import type { AuditSink, RequestPipeline } from "./contracts.js";

/** Demands the divergent contract through its CONTRACT key, which is always the working spelling. */
type DivergentConsumerDeps = { auditSink: AuditSink };

export const buildDivergentConsumer = ({
  auditSink,
}: DivergentConsumerDeps): RequestPipeline => ({
  run: (path: string) => {
    auditSink.write(path);
    return path;
  },
});
