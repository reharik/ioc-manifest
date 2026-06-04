import type { MediaStorage as StorageApi } from "@test/lib-foo";

type RenamedDeps = {
  mediaStorage: StorageApi;
};

export type RenamedService = { readonly id: string };

export const buildRenamedService = ({
  mediaStorage: _mediaStorage,
}: RenamedDeps): RenamedService => ({ id: "x" });
