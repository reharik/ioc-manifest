// REJECTED by the deps-position backstop: naming a generated type is fine in general, but a deps
// property is read member-by-member, so it has to be one of the claimed forms.
import type { MediaStorage, UploadService } from "./contracts.js";
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
