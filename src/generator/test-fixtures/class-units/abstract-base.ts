import type { MediaStorage } from "./contracts.js";

/** Abstract classes cannot be constructed, so they are never registration units. */
export abstract class MediaStorageBase implements MediaStorage {
  abstract label: string;

  put(): void {
    /* noop */
  }
}
