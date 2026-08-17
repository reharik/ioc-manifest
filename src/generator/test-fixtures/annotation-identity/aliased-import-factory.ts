import type { QueueTask as QT } from "./contracts.js";

export const buildAliasedQueueTask = (): QT => ({ run: () => "aliased" });
