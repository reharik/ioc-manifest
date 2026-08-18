import type { MediaStorage } from "./contracts.js";

/** Factory unit for the same contract a class unit implements — default election must not care. */
export const buildTapeMediaStorage = (): MediaStorage => ({
  label: "tape",
  put: () => {
    /* noop */
  },
});
