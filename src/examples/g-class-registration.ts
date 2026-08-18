import type { MediaStorage } from "./b-multiple-implementations.js";

type ArchiveMediaStorageDeps = {
  mediaStorage: MediaStorage;
};

/**
 * A class registration unit. The `implements` clause is the contract site — exactly what a
 * factory's return type annotation is — so this registers as another `MediaStorage`
 * implementation, joins `mediaStoragesGroup`, and takes part in default election on identical
 * terms with the factories in the sibling examples.
 *
 * Dependencies come from the constructor's single destructured object parameter (Awilix PROXY
 * injection); the registration key is the camelCased class name, `archiveMediaStorage`.
 */
export class ArchiveMediaStorage implements MediaStorage {
  label = "archive";

  readonly #backing: MediaStorage;

  constructor({ mediaStorage }: ArchiveMediaStorageDeps) {
    this.#backing = mediaStorage;
  }

  async put(key: string): Promise<void> {
    await this.#backing.put(`archive/${key}`);
  }
}
