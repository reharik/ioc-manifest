export type CacheClient = {
  get: (k: string) => string | undefined;
};

export const buildMemoryCache = (): CacheClient => {
  const store = new Map<string, string>();
  return {
    get: (k: string) => store.get(k),
  };
};
