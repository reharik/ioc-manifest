// RESOLVED: inline `type` modifier on a named import specifier.
import type { MediaStorage, UploadService } from "./contracts.js";
import { type Channels } from "./generated/ioc-registry.types.js";

type Deps = { channels: Channels };

export const buildStorage = (): MediaStorage => ({
  upload: (name) => name,
});

export const buildUploadService = ({ channels }: Deps): UploadService => ({
  upload: (name) => {
    void channels;
    return name;
  },
});
