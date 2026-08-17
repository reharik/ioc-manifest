// RESOLVED: the alias lives in ANOTHER module, so the factory file imports nothing generated.
import type { MediaStorage, UploadService } from "./contracts.js";
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
