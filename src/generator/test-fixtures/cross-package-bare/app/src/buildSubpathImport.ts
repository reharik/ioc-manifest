import type { SubpathType } from "@test/lib-foo/subpath";

type SubpathDeps = {
  item: SubpathType;
};

export type SubpathService = { readonly n: number };

export const buildSubpathService = ({ item: _item }: SubpathDeps): SubpathService => ({
  n: 1,
});
