import type { MediaStorage } from "./contracts.js";

/** No parameters at all: demands nothing, and known to. */
export const buildMediaStorage = (): MediaStorage => ({
  put: () => undefined,
});
