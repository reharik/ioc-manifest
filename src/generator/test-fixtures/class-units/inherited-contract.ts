import type { MediaStorage } from "./contracts.js";

/** Shared base carrying the contract — the documented base-class pattern. */
export abstract class InheritingStorageBase implements MediaStorage {
  abstract label: string;

  put(): void {
    /* noop */
  }
}

/**
 * The near miss: concrete, exported, inherits `MediaStorage` through the base — but restates no
 * `implements`, so it is not a registration unit. Discovery reports it rather than dropping it.
 */
export class InheritedOnlyStorage extends InheritingStorageBase {
  label = "inherited";
}

/** Two links up, to pin that the walk follows the whole `extends` chain. */
export class DeepInheritedStorage extends InheritedOnlyStorage {
  override label = "deep";
}
