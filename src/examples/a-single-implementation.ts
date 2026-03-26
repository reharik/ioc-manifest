export type Logger = {
  log: (message: string) => void;
};

export const buildConsoleLogger = (): Logger => {
  return {
    log: (message: string) => {
      console.log(`[example/logger] ${message}`);
    },
  };
};
