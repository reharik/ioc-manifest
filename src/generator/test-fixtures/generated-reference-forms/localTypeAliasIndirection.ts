// RESOLVED: a same-file alias standing between the deps property and the claimed form.
import type { MediaStorage, UploadService } from "./contracts.js";
import type { IocGeneratedCradle } from "./generated/ioc-registry.types.js";

type LocalStorage = IocGeneratedCradle["storage"];
type Deps = { storage: LocalStorage };

export const buildStorage = (): MediaStorage => ({
  upload: (name) => name,
});

export const buildUploadService = ({ storage }: Deps): UploadService => ({
  upload: (name) => {
    void storage;
    return name;
  },
});
