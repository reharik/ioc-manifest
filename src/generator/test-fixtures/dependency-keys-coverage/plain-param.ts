import type { MediaServeController, MediaStorage } from "./contracts.js";

type MediaServeControllerDeps = {
  mediaStorage: MediaStorage;
};

/**
 * The same unit, written the other idiomatic way: one dependency, taken as a whole `deps` object.
 *
 * Nothing is wrong with it, and nothing about it can be read syntactically — which is the point.
 * The manifest records no keys for this unit and must not claim it recorded them all.
 */
export const buildMediaServeController = (
  deps: MediaServeControllerDeps,
): MediaServeController => ({
  serve: (id) => {
    deps.mediaStorage.put(id);
    return id;
  },
});
