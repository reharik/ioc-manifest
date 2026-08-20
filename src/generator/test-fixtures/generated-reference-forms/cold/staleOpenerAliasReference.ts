// COLD START: same rejection with no generated file on disk. The "stale output" reading is drawn
// from the name's SHAPE and this generation's opener set, never from reading prior output — so it
// holds identically when there is no prior output to read.
import type { MediaStorage, UploadService } from "../contracts.js";
import type { OpenRetiredRouterScope } from "./generated/ioc-registry.types.js";

type Deps = { openRetiredRouterScope: OpenRetiredRouterScope };

export const buildStorage = (): MediaStorage => ({
  upload: (name) => name,
});

export const buildUploadService = ({
  openRetiredRouterScope,
}: Deps): UploadService => ({
  upload: (name) => {
    void openRetiredRouterScope;
    return name;
  },
});
