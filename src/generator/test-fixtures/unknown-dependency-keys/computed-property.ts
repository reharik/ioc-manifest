import type { ComputedProperty, Logger } from "./contracts.js";

type ComputedPropertyDeps = { logger: Logger };

const LOGGER_KEY = "logger";

/** A computed property name: not resolvable before the code runs. */
export const buildComputedProperty = ({
  [LOGGER_KEY]: logger,
}: ComputedPropertyDeps): ComputedProperty => ({
  run: () => logger.log("x"),
});
