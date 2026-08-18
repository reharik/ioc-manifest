import type { Storage } from "../types/Storage.js";

type ArchiveStorageDeps = {
  localStorage: Storage;
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
