import type { MediaStorage } from "@test/lib-foo";

export function buildStorage(): MediaStorage {
  return {
    store: async () => {},
  };
}
