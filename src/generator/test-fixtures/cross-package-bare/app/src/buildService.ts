import type { MediaStorage } from "@test/lib-foo";

type SomeServiceDeps = {
  mediaStorage: MediaStorage;
};

export type SomeService = { readonly run: () => void };

export const buildSomeService = ({
  mediaStorage: _mediaStorage,
}: SomeServiceDeps): SomeService => ({
  run: () => {},
});
