export type MediaStorage = {
  readonly store: (key: string, data: Uint8Array) => Promise<void>;
};
