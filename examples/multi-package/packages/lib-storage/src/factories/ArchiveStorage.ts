import type { Named } from "ioc-manifest";
import type { Storage } from "../types/Storage.js";

type ArchiveStorageDeps = {
  /**
   * A NAMED implementation demand: `localStorage` is `buildLocalStorage`'s own registration key,
   * not the `Storage` contract key. `Named<Storage>` is what says so — it declares "the
   * implementation registered as `localStorage`, whose contract is `Storage`", and it keeps meaning
   * that when `ioc.config` moves the contract default somewhere else. Writing `storage: Storage`
   * here would ask for whichever implementation is elected, which is a different dependency.
   */
  localStorage: Named<Storage>;
};

/**
 * Class registration unit, discovered from its `implements` clause and registered next to the
 * factory units in this same package. It joins the `storages` collection group like any other
 * `Storage` implementation, and takes its dependency through the constructor's single destructured
 * object parameter (Awilix PROXY injection). Registration key: `archiveStorage`.
 */
export class ArchiveStorage implements Storage {
  readonly label = "archive";

  readonly #backing: Storage;

  constructor({ localStorage }: ArchiveStorageDeps) {
    this.#backing = localStorage;
  }

  put(key: string): void {
    this.#backing.put(`archive/${key}`);
  }
}
