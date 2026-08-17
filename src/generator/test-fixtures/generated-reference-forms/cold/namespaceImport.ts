// COLD START: the generated file this refers to does NOT exist on disk. Resolution has to come
// off the source text alone — the exact condition where a fall-through deadlocks instead of
// silently going stale.
import type { MediaStorage, UploadService } from "../contracts.js";
import type * as Ioc from "./generated/ioc-registry.types.js";

type Deps = {
  storage: Ioc.IocGeneratedCradle["storage"];
  channels: Ioc.Channels;
};

export const buildStorage = (): MediaStorage => ({
  upload: (name) => name,
});

export const buildUploadService = ({
  storage,
  channels,
}: Deps): UploadService => ({
  upload: (name) => {
    void storage;
    void channels;
    return name;
  },
});
