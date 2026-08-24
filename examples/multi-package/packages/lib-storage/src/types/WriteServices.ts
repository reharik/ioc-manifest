import type { WriteService } from "@example/lib-contracts/types/WriteService.js";

/** One member contract of `writeServices`, keyed into the group value as `toggleReaction`. */
export interface ToggleReaction extends WriteService {
  react: (on: string) => string;
}

/** The other, and the one that needs its sibling. */
export interface AddComment extends WriteService {
  add: (body: string) => string;
}
