import type { QueueTask } from "./contracts.js";

export const buildAsyncQueueTask = (): Promise<QueueTask> =>
  Promise.resolve({ run: () => "async" });
