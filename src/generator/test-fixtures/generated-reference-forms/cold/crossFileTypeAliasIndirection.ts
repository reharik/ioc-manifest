// COLD START: the generated file this refers to does NOT exist on disk. Resolution has to come
// off the source text alone — the exact condition where a fall-through deadlocks instead of
// silently going stale.
import type { MediaStorage, UploadService } from "../contracts.js";
import type {
  SharedChannels,
  SharedStorage,
} from "./crossFileTypeAliasIndirection.aliases.js";

type Deps = { storage: SharedStorage; channels: SharedChannels };

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
