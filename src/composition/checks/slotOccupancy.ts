/**
 * @fileoverview `[slot-occupancy]` — a registration owning its contract's slot key must be the
 * electee. The rule, its exclusions and its wording all live in `core/contractSlotOccupancy.ts`;
 * this is the composed-set view of it.
 *
 * `ioc generate` gates the same rule against its registration plan, package-locally and in both
 * modes. This adds the thing a plan cannot see: composition MERGES a contract's implementations and
 * can MOVE its election, so an app can create the shape out of two packages that are each fine on
 * their own — a library registering `mediaStorage` and an app electing `s3MediaStorage` over it.
 * Same rule, same sentences, one verb further out.
 */
import { resolveManifestAccessKey } from "../../core/contractAccessKey.js";
import {
  findContractSlotOccupancyViolations,
  formatSlotOccupancyClaim,
  formatSlotOccupancyLocation,
  formatSlotOccupancyRemedy,
  type ContractSlotOccupancyRow,
} from "../../core/contractSlotOccupancy.js";
import type { CompositionContext, ValidationIssue } from "../types.js";
import {
  composedContractNamesSorted,
  electedImplementationName,
  groupedContractNamesAcrossSlices,
  mergedRowsForContract,
} from "./composedContractRows.js";

export const checkSlotOccupancy = (
  ctx: CompositionContext,
): ValidationIssue[] => {
  const groupedContractNames = groupedContractNamesAcrossSlices(ctx);
  const rows: ContractSlotOccupancyRow[] = [];

  for (const contractName of composedContractNamesSorted(ctx)) {
    // Grouped ⇒ group-only: no slot, so no key to occupy.
    if (groupedContractNames.has(contractName)) {
      continue;
    }

    const merged = mergedRowsForContract(ctx, contractName);
    const elected = electedImplementationName(ctx, contractName, merged);
    if (elected === undefined) {
      // The election itself is broken; `default-ambiguity` says so. Naming a second problem that
      // only exists because of the first would be noise.
      continue;
    }

    const electedRow = merged.rows.find(
      (row) => row.implementationName === elected,
    );
    if (electedRow === undefined) {
      // An app override naming an implementation nobody registers — `app-config` territory.
      continue;
    }

    // `accessKey` is emitted onto whichever implementation carried it and omitted when it equals
    // the convention key, so this reads the whole merged set rather than one slice's.
    const slotKey = resolveManifestAccessKey(
      contractName,
      ctx.slices.flatMap((slice) =>
        Object.values(slice.contracts[contractName] ?? {}),
      ),
    );

    rows.push({
      contractName,
      slotKey,
      electedImplementationName: elected,
      electedRegistrationKey: electedRow.registrationKey,
      implementations: merged.rows.map((row) => ({
        implementationName: row.implementationName,
        registrationKey: row.registrationKey,
        packageLabel: row.packageLabel,
      })),
    });
  }

  return findContractSlotOccupancyViolations(rows).map((violation) => {
    const location = formatSlotOccupancyLocation(violation);
    return {
      category: "slot-occupancy" as const,
      severity: "error" as const,
      summary: formatSlotOccupancyClaim(violation),
      details: [
        ...(location !== undefined ? [location] : []),
        `The slot key names the ELECTED implementation and keeps naming it when the election moves. A registration under that same name owns the key instead, so ${JSON.stringify(violation.slotKey)} hands out ${JSON.stringify(violation.occupantImplementationName)} while the election names ${JSON.stringify(violation.electedImplementationName)}.`,
      ],
      suggestedFix: formatSlotOccupancyRemedy(violation),
    };
  });
};
