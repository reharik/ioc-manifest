import type { MediaServeController, MediaStorage } from "./contracts.js";

type MediaServeControllerDeps = {
  mediaStorage: MediaStorage;
};

/** Destructured deps parameter: every key it demands is readable from the binding pattern. */
export const buildMediaServeController = ({
  mediaStorage,
}: MediaServeControllerDeps): MediaServeController => ({
  serve: (id) => {
    mediaStorage.put(id);
    return id;
  },
});
