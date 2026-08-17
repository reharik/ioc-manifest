// RESOLVED: the canonical indexed access on the cradle.
import type { MediaStorage, UploadService } from "./contracts.js";
import type { IocGeneratedCradle } from "./generated/ioc-registry.types.js";

type Deps = { storage: IocGeneratedCradle["storage"] };

export const buildStorage = (): MediaStorage => ({
  upload: (name) => name,
});

export const buildUploadService = ({ storage }: Deps): UploadService => ({
  upload: (name) => {
    void storage;
    return name;
  },
});
