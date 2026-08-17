// RESOLVED: namespace import, qualified access for both claimed shapes.
import type { MediaStorage, UploadService } from "./contracts.js";
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
