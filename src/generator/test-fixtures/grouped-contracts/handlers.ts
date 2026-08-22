import type { DomainEventHandler } from "./contracts.js";

/**
 * Five implementations of one contract, none marked default — the field's shape exactly.
 *
 * Before grouped ⇒ group-only this was `[default-ambiguity]`: the contract had a slot, nothing
 * elected one, and the report told the developer to pick a default for a key no consumer should
 * ever have named. Grouped vacates the question rather than answering it.
 */
export const buildAlphaHandler = (): DomainEventHandler => ({
  handle: (event: string) => `alpha:${event}`,
});
export const buildBetaHandler = (): DomainEventHandler => ({
  handle: (event: string) => `beta:${event}`,
});
export const buildGammaHandler = (): DomainEventHandler => ({
  handle: (event: string) => `gamma:${event}`,
});
export const buildDeltaHandler = (): DomainEventHandler => ({
  handle: (event: string) => `delta:${event}`,
});
/** Registered under the camel-cased CONTRACT name — the key the slot would have taken. */
export const buildDomainEventHandler = (): DomainEventHandler => ({
  handle: (event: string) => `epsilon:${event}`,
});
