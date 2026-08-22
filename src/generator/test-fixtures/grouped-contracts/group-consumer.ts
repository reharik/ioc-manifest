import type { Consumer } from "./contracts.js";
import type { DomainEventHandlers } from "./generated/ioc-registry.types.js";

/** The only legal way to reach the family: the group root key, by its emitted alias. */
type GroupConsumerDeps = { domainEventHandlers: DomainEventHandlers };

export const buildGroupConsumer = ({
  domainEventHandlers,
}: GroupConsumerDeps): Consumer => ({
  run: () => domainEventHandlers.map((h) => h.handle("e")).join(","),
});
