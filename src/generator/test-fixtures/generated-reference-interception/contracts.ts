export type Channel = {
  name: string;
  send: (message: string) => Promise<void>;
};
