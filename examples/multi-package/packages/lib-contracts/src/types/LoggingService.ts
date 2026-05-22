/** Shared base type for cross-package `loggers` collection group (§8). */
export type LoggingService = {
  readonly id: string;
  ping: () => string;
};
