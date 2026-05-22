import type { Storage } from "../types/Storage.js";

export const buildS3Storage = (): Storage => ({
  label: "s3",
  put: () => {
    /* noop */
  },
});
