import type {
  EmptyExtendsTask,
  QueueTask,
  TaskDecision,
} from "./contracts.js";

export const buildEmptyExtendsTask = (): EmptyExtendsTask => ({
  run: () => "empty-extends",
});

export const buildQueueTask = (): QueueTask => ({ run: () => "queue" });

export const buildTaskDecision = (): TaskDecision => ({ kind: "done" });
