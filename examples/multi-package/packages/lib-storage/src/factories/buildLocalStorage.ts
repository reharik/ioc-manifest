import type { Storage } from "../types/Storage.js";

export const buildLocalStorage = (): Storage => ({
  label: "local",
  put: () => {
    /* noop */
  },
});
