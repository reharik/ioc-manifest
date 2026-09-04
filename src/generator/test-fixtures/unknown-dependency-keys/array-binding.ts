import type { ArrayBinding, Logger } from "./contracts.js";

/** An array binding pattern: positional, where the cradle is keyed by registration name. */
export const buildArrayBinding = ([logger]: [Logger]): ArrayBinding => ({
  run: () => logger.log("x"),
});
