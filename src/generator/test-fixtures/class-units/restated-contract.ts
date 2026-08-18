import type { MediaStorage } from "./contracts.js";

/** Abstract base declaring the contract, with a concrete subclass that restates it. */
export abstract class RestatedStorageBase implements MediaStorage {
  abstract label: string;

  put(): void {
    /* noop */
  }
}

/**
 * The supported base-class pattern: the concrete class restates `implements`, so it registers and
 * the base's `implements` is doing exactly its job — no warning belongs on either class.
 */
export class RestatedStorage
  extends RestatedStorageBase
  implements MediaStorage
{
  label = "restated";
}
