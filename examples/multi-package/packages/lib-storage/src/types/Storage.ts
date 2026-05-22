export type Storage = {
  readonly label: string;
  put: (key: string) => void;
};
