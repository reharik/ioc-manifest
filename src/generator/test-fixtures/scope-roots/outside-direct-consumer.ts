/**
 * An ordinary factory, outside every scope-root subtree, demanding the key a variant declares.
 *
 * Nothing about the declaration reaches this consumer: it resolves `auditContext` from the root
 * container like any other dependency. Excluding the key would delete the ask that supplies it and
 * break this unit at resolution time, so the key stays in `Externals`.
 */
import type { AuditContext } from "./outside-demander.js";
import type { ISessionStore } from "./deps-contracts.js";

type DirectConsumerDeps = { auditContext: AuditContext };

export const buildDirectConsumer = ({
  auditContext,
}: DirectConsumerDeps): ISessionStore => ({
  get: (id: string) => `${auditContext.id}:${id}`,
});
