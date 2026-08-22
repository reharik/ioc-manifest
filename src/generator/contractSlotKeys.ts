/**
 * @fileoverview Contract-slot keys: the cradle property that names a contract's ELECTED DEFAULT.
 *
 * A contract with an elected default answers to two kinds of name — the implementation's own
 * registration key, and the contract's access key. The second is the slot key, and it is the name a
 * consumer is meant to write: it says "the elected `AuthMiddleware`", and it keeps saying that when
 * the election moves to a different implementation.
 *
 * Runtime has always registered it (`registerContractDefaultAliases` writes `aliasTo(elected)`).
 * What this module supplies is the same key to the STATIC layers — the emitted cradle, the
 * demand/supply supply set, and the scope-root subtree walk — so that all four agree on which
 * properties exist and what they resolve to.
 *
 * ### When the key does not exist
 *
 * No election, no slot key — the key is absent from every layer, and a demand for it is unsatisfied
 * exactly as a demand for any unregistered name is. Two shapes reach that state:
 *
 * - a group-base contract with no explicitly elected default (`contractDefaultElected === false`),
 *   which is the only unelected shape that survives to emission;
 * - a multi-implementation contract with zero or several `default: true`, which never gets this far
 *   — `selectDefaultImplementationName` hard-errors at generation, and `ioc validate` reports it as
 *   `default-ambiguity` against an already-written manifest.
 *
 * Scope-rooted contracts are a third absence, and they are absent by construction rather than by a
 * rule here: a scope root claims no registration key and reaches no registration plan at all, so it
 * has no `ResolvedContractRegistration` for a slot key to be derived from. Scope-rooted contracts
 * are opener-only.
 */
import type { ResolvedContractRegistration } from "./resolveRegistrationPlan.js";

/** One contract's default slot, as every static layer consumes it. */
export type ContractSlot = {
  /** The cradle property name — explicit `$contract.accessKey`, else the camel-cased contract name. */
  accessKey: string;
  contractName: string;
  /** Type-only import specifier for the contract symbol, for emission by reference. */
  contractTypeRelImport: string;
  /**
   * Registration key of the ELECTED implementation.
   *
   * For an alias slot — the only kind any layer resolves through — this is exactly what
   * `registerContractDefaultAliases` writes `aliasTo(…)` for, and what the scope-root walk descends
   * to when it crosses a slot-key edge.
   *
   * When an implementation is already registered UNDER the access key (the convention case,
   * `buildMediaStorage` → `mediaStorage` for `MediaStorage`), no alias exists: Awilix cannot hold
   * two registrations under one name, so that registration owns the key at runtime and every static
   * layer resolves the key as a registration before it ever consults a slot. That occupant is the
   * ELECTEE — `validateContractSlotOccupancyAtCodegen` hard-errors on any other arrangement, since a
   * key that hands out one implementation while the election names another makes the slot mean two
   * things — so this field and the occupying registration key are the same string there.
   */
  electedRegistrationKey: string;
};

/**
 * The slot keys this generation's contracts claim, in plan order.
 *
 * A plan whose default was not elected contributes nothing, and neither does one whose elected
 * implementation cannot be found among its own implementations (defensive: the plan builder always
 * elects from the list it holds).
 */
export const contractSlotsForPlans = (
  plans: readonly ResolvedContractRegistration[],
): ContractSlot[] => {
  const slots: ContractSlot[] = [];
  for (const plan of plans) {
    if (plan.contractDefaultElected === false) {
      continue;
    }
    const elected = plan.implementations.find(
      (impl) => impl.implementationName === plan.defaultImplementationName,
    );
    if (elected === undefined) {
      continue;
    }
    slots.push({
      accessKey: plan.accessKey,
      contractName: plan.contractName,
      contractTypeRelImport: plan.contractTypeRelImport,
      electedRegistrationKey: elected.registrationKey,
    });
  }
  return slots;
};

/** Every registration key the plans claim, across all contracts. */
export const registrationKeysForPlans = (
  plans: readonly ResolvedContractRegistration[],
): Set<string> => {
  const keys = new Set<string>();
  for (const plan of plans) {
    for (const impl of plan.implementations) {
      keys.add(impl.registrationKey);
    }
  }
  return keys;
};

/**
 * Slot keys that are genuine ALIASES — a name no registration of its own claims.
 *
 * The distinction is the runtime's: `registerContractDefaultAliases` registers `aliasTo(elected)`
 * only when no implementation is already registered under the access key. When one is (the
 * convention case, `buildMediaStorage` → `mediaStorage` for `MediaStorage`), the slot key IS that
 * registration and carries that registration's own supply type; there is no alias and nothing to
 * emit twice. Such an occupant is always the elected implementation, so the key means the same
 * thing either way — see `core/contractSlotOccupancy.ts`.
 */
export const aliasContractSlotKeys = (
  plans: readonly ResolvedContractRegistration[],
): Set<string> => {
  const registrationKeys = registrationKeysForPlans(plans);
  return new Set(
    contractSlotsForPlans(plans)
      .map((slot) => slot.accessKey)
      .filter((accessKey) => !registrationKeys.has(accessKey)),
  );
};
