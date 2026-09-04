import type { CallableParameterType, Logger } from "./contracts.js";

/** Destructured, but off a type that is itself callable — a cradle it is not. */
type CallableDeps = {
  (input: string): void;
  logger: Logger;
};

export const buildCallableParameterType = ({
  logger,
}: CallableDeps): CallableParameterType => ({
  run: () => logger.log("x"),
});
