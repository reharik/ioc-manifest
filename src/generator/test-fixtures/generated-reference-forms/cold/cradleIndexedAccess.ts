// COLD START: the generated file this refers to does NOT exist on disk. Resolution has to come
// off the source text alone — the exact condition where a fall-through deadlocks instead of
// silently going stale.
import type { MediaStorage, UploadService } from "../contracts.js";
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
