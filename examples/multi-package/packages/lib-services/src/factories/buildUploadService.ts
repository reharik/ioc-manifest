import type { Storage } from "@example/lib-storage";
import type { Logger } from "../types/Logger.js";
import type { UploadService } from "../types/UploadService.js";

type UploadServiceDeps = {
  storage: Storage;
  logger: Logger;
};

export const buildUploadService = ({
  storage,
  logger,
}: UploadServiceDeps): UploadService => ({
  upload: (key: string) => {
    storage.put(key);
    return logger.log(`uploaded ${key} via ${storage.label}`);
  },
});
