import type { ToggleReaction } from "../types/WriteServices.js";

export const buildToggleReaction = (): ToggleReaction => ({
  writes: "reactions",
  react: (on) => `reacted:${on}`,
});
