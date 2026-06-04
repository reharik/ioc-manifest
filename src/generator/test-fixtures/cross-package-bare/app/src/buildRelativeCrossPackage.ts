import type { MediaStorage } from "../../../packages/lib-foo/src/MediaStorage.js";

type RelativeDeps = {
  mediaStorage: MediaStorage;
};

export type RelativeService = { readonly ok: boolean };

export const buildRelativeService = ({
  mediaStorage: _mediaStorage,
}: RelativeDeps): RelativeService => ({ ok: true });
