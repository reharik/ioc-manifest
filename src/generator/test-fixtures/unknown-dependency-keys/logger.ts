import type { Logger } from "./contracts.js";

/** The one dependency every offender in this fixture demands. Readable itself: no parameters. */
export const buildLogger = (): Logger => ({ log: () => undefined });
