/**
 * @fileoverview Codegen gate for the slot-occupancy rule: a registration owning its contract's slot
 * key must be the electee (see `core/contractSlotOccupancy.ts` for the rule and its exclusions).
 *
 * Runs straight off the registration plan, which is the first point where both facts exist — the
 * election has been resolved and every implementation's registration key is known — and well before
 * anything type-sensitive reads a slot key. Offender-bucketed: one error listing every contract in
 * the state, so a package with several gets one worklist rather than four runs.
 *
 * Library mode included. This is a package-local rule — the occupant, the slot key and the election
 * are all in one plan — so it is not the composition suite's business alone, and a library that
 * ships the shape would otherwise export a manifest whose contract key hands out the wrong
 * implementation to every app that composes it.
 */
import {
  findContractSlotOccupancyViolations,
  formatSlotOccupancyClaim,
  formatSlotOccupancyLocation,
  formatSlotOccupancyRemedy,
  type ContractSlotOccupancyRow,
} from "../core/contractSlotOccupancy.js";
import type { ResolvedContractRegistration } from "./resolveRegistrationPlan.js";

/** Plans in the terms the shared rule reads them. Unelected contracts contribute nothing. */
const occupancyRowsForPlans = (
  plans: readonly ResolvedContractRegistration[],
): ContractSlotOccupancyRow[] => {
  const rows: ContractSlotOccupancyRow[] = [];
  for (const plan of plans) {
    // Grouped ⇒ group-only: `contractDefaultElected === false` is exactly the no-slot state, so
    // there is no key to occupy. Scope-rooted contracts never reach a plan at all.
    if (plan.contractDefaultElected === false) {
      continue;
    }
    const elected = plan.implementations.find(
      (impl) => impl.implementationName === plan.defaultImplementationName,
    );
    if (elected === undefined) {
      continue;
    }
    rows.push({
      contractName: plan.contractName,
      slotKey: plan.accessKey,
      electedImplementationName: elected.implementationName,
      electedRegistrationKey: elected.registrationKey,
      implementations: plan.implementations.map((impl) => ({
        implementationName: impl.implementationName,
        registrationKey: impl.registrationKey,
        exportName: impl.exportName,
        modulePath: impl.modulePath,
      })),
    });
  }
  return rows;
};

/**
 * Throws one aggregated error when any registration occupies a slot key it has not been elected to.
 */
export const validateContractSlotOccupancyAtCodegen = (
  plans: readonly ResolvedContractRegistration[],
): void => {
  const violations = findContractSlotOccupancyViolations(
    occupancyRowsForPlans(plans),
  );
  if (violations.length === 0) {
    return;
  }

  const lines = [
    `[ioc] ${violations.length} registration(s) occupy their contract's slot key without being the elected default. ` +
      "The slot key names the ELECTED implementation and keeps naming it when the election moves; a registration " +
      "under that same name owns the key instead, so the key hands out the occupant while the election names " +
      "someone else. Pick one of the two:",
    ...violations.map((violation) => {
      const location = formatSlotOccupancyLocation(violation);
      return (
        `  - ${formatSlotOccupancyClaim(violation)}${location !== undefined ? ` [${location}]` : ""}. ` +
        formatSlotOccupancyRemedy(violation)
      );
    }),
  ];

  throw new Error(lines.join("\n"));
};
