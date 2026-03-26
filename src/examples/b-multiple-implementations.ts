export type MediaStorage = {
  label: string;
  put: (key: string) => Promise<void>;
};

export const buildLocalMediaStorage = (): MediaStorage => {
  return {
    label: "local",
    put: async () => {
      /* noop */
    },
  };
};

export const buildS3MediaStorage = (): MediaStorage => {
  return {
    label: "s3",
    put: async () => {
      /* noop */
    },
  };
};
