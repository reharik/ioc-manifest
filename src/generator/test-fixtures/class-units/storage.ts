import type { MediaStorage } from "./contracts.js";

/**
 * File stem (`storage`) differs from the class name, so Awilix `loadModules` would have keyed this
 * on `storage` while ioc-manifest keys it on `localMediaStorage`.
 */
export class LocalMediaStorage implements MediaStorage {
  label = "local";

  put(): void {
    /* noop */
  }
}
