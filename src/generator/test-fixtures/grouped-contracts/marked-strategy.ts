import type { MarkedStrategy } from "./contracts.js";

/**
 * A `NotificationStrategy` member whose contract declares its own lifetime marker, which the base
 * does not carry. Ruling 2: the member is claiming authority over a property of the family.
 */
export const buildMarkedStrategy = (): MarkedStrategy => ({
  medium: "marked",
  notify: (message: string) => `marked:${message}`,
});
