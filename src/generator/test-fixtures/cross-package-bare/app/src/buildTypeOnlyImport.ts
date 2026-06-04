import { type MediaStorage } from "@test/lib-foo";

type TypeOnlyDeps = {
  mediaStorage: MediaStorage;
};

export type TypeOnlyService = { readonly flag: boolean };

export const buildTypeOnlyService = ({
  mediaStorage: _mediaStorage,
}: TypeOnlyDeps): TypeOnlyService => ({ flag: true });
