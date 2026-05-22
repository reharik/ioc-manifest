import type { Logger } from "../types/Logger.js";

export const buildConsoleLogger = (): Logger => ({
  log: (message: string) => `hello: ${message}`,
});
