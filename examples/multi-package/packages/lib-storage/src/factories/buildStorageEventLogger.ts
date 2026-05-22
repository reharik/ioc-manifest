import type { LoggingService } from "@example/lib-contracts/types/LoggingService.js";

export const buildStorageEventLogger = (): LoggingService => ({
  id: "storageEventLogger",
  ping: () => "storage-event",
});
