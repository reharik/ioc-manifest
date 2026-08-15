// Invalid because the return annotation is a bare union alias: the alias resolves to a union
// type, which has no single contract symbol, so contract resolution fails (contract_not_resolved).
export type TaskOutcome = { kind: "done" } | { kind: "retry" };

export const buildUnionTask = (): TaskOutcome => ({ kind: "done" });
