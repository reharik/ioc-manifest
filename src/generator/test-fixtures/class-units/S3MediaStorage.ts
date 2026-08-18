import type { MediaStorage } from "./contracts.js";

/** Plain class unit: `implements` is the contract site, no constructor, no dependencies. */
export class S3MediaStorage implements MediaStorage {
  label = "s3";

  put(): void {
    /* noop */
  }
}
