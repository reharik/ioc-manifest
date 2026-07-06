import type { SweepReport, SweepTask, WorkerTask } from "./contracts.js";
// A factory importing a generated group alias by name from the generated output file.
import type { SweepTasks } from "./generated/ioc-registry.types.js";

export const buildSweepTask = (): SweepTask => ({
  run: () => {},
});

// Member of the `workerTasks` group; its alias `WorkerTasks` is never imported by a factory.
export const buildWorkerTask = (): WorkerTask => ({
  work: () => {},
});

// Depends on the group alias under a key that is NOT the group name, so the alias type is
// resolved and emitted (rather than short-circuited by group resolution) — the shape that
// previously produced a self-import from the generated file into itself.
type SweepReportDeps = {
  pendingSweeps: SweepTasks;
};

export const buildSweepReport = ({
  pendingSweeps,
}: SweepReportDeps): SweepReport => ({
  total: pendingSweeps.length,
});
