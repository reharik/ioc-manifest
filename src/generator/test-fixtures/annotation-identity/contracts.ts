export interface WorkerTaskBase {
  run: () => string;
}

/** v2 trap form: empty interface extending the base (pre-v3 requirement). */
export interface EmptyExtendsTask extends WorkerTaskBase {}

/** v3 first-class form: plain type alias of the base — a distinct contract, never collapsed. */
export type QueueTask = WorkerTaskBase;

/** v3 first-class form: named union alias — a contract with no group/marker membership. */
export type TaskDecision = { kind: "done" } | { kind: "retry" };
