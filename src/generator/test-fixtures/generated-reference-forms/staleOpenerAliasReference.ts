// REJECTED by the deps-position backstop: `OpenRetiredRouterScope` is shaped like an emitted opener
// alias, but this fixture declares no variant that would produce it — so the name can only have come
// from a PREVIOUS generation's output, and the diagnostic says "regenerate" rather than "demand the
// individual keys".
import type { MediaStorage, UploadService } from "./contracts.js";
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
