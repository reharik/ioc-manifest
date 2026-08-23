import type { SlackStrategy } from "./contracts.js";

/**
 * A record-group member whose IMPLEMENTATION is named nothing like its CONTRACT.
 *
 * This is the only shape that can tell the object group's two candidate property spellings apart:
 * the contract key (`slackStrategy`) and the member's registration key (`slackNotifier`). Every
 * other member in this fixture set has an implementation named after its contract, so the two
 * coincide and an assertion over them proves nothing.
 */
export const buildSlackNotifier = (): SlackStrategy => ({
  medium: "slack",
  notify: (message: string) => `slack:${message}`,
});
