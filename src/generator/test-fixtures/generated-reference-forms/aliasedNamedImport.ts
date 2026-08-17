// RESOLVED: the cradle imported under an alias, indexed by a string literal.
import type { MediaStorage, UploadService } from "./contracts.js";
import type { IocGeneratedCradle as Cradle } from "./generated/ioc-registry.types.js";

type Deps = { storage: Cradle["storage"] };

export const buildStorage = (): MediaStorage => ({
  upload: (name) => name,
});

export const buildUploadService = ({ storage }: Deps): UploadService => ({
  upload: (name) => {
    void storage;
    return name;
  },
});
