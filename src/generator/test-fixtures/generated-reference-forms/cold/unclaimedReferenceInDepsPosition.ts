// COLD START: the generated file this refers to does NOT exist on disk. Resolution has to come
// off the source text alone — the exact condition where a fall-through deadlocks instead of
// silently going stale.
import type { MediaStorage, UploadService } from "../contracts.js";
import type { Channels } from "./generated/ioc-registry.types.js";

type Deps = { channels: ReadonlyArray<Channels> };

export const buildStorage = (): MediaStorage => ({
  upload: (name) => name,
});

export const buildUploadService = ({ channels }: Deps): UploadService => ({
  upload: (name) => {
    void channels;
    return name;
  },
});
