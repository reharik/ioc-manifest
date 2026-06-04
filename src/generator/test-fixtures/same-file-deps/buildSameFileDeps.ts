export type Config = { value: string };

export type SomeServiceDeps = { config: Config };

export type SomeService = { run: () => void };

export const buildSomeService = ({ config }: SomeServiceDeps): SomeService => ({
  run: () => {
    console.log(config.value);
  },
});
