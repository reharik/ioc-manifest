import { selectDefaultImplementationName } from "../../core/defaultImplementationSelection.js";
import { contractNameToDefaultRegistrationKey } from "../../generator/naming.js";
import type { CompositionContext, ValidationIssue } from "../types.js";
import { sourceIdsForSliceIndexes } from "../sliceLabel.js";
import {
  composedContractNamesSorted,
  groupedContractNamesAcrossSlices,
  mergedRowsForContract,
} from "./composedContractRows.js";

export const checkDefaultAmbiguity = (
  ctx: CompositionContext,
): ValidationIssue[] => {
  // Grouped ⇒ group-only, so a grouped contract backs no default slot and there is nothing for a
  // default to be ambiguous ABOUT. The check is vacated by construction rather than passed: several
  // implementations with no `default: true` is the ordinary, correct shape of a group, and reporting
  // it as ambiguity told developers to elect a default for a key that does not exist.
  const groupedContractNames = groupedContractNamesAcrossSlices(ctx);

  const issues: ValidationIssue[] = [];

  for (const contractName of composedContractNamesSorted(ctx)) {
    if (groupedContractNames.has(contractName)) {
      continue;
    }

    const appDefault =
      ctx.overrides?.contracts?.[contractName]?.defaultImplementation;
    if (appDefault !== undefined) {
      continue;
    }

    const { rows, manifestDefaults } = mergedRowsForContract(ctx, contractName);

    if (rows.length === 0) {
      continue;
    }

    if (manifestDefaults.length > 1) {
      issues.push({
        category: "default-ambiguity",
        severity: "error",
        summary: `Conflicting default declaration for contract ${JSON.stringify(contractName)} across manifests`,
        details: manifestDefaults.map(
          (d) =>
            `- ${d.packageLabel}: implementation ${d.implementationName}`,
        ),
        suggestedFix:
          `Declare registrations.${JSON.stringify(contractName)}.<implementation>.default: true in your app's ioc.config.ts for exactly one implementation.`,
        packages: sourceIdsForSliceIndexes(
          ctx.slices,
          manifestDefaults.map((d) => d.sliceIndex),
        ),
      });
      continue;
    }

    try {
      selectDefaultImplementationName(
        contractName,
        rows.map((r) => ({
          implementationName: r.implementationName,
          registrationKey: r.registrationKey,
          ...(r.default === true ? { default: true as const } : {}),
        })),
      );
    } catch {
      const contractKey = contractNameToDefaultRegistrationKey(contractName);
      const implList = rows
        .map((r) => r.implementationName)
        .sort((a, b) => a.localeCompare(b))
        .join(", ");
      issues.push({
        category: "default-ambiguity",
        severity: "error",
        summary: `Default for ${JSON.stringify(contractName)} is ambiguous across the composed set`,
        details: [
          `Implementations: ${implList}`,
          `Convention key (camel-cased contract name): ${JSON.stringify(contractKey)}`,
          ...rows.map(
            (r) =>
              `- ${r.packageLabel}: ${r.implementationName} → registration key ${JSON.stringify(r.registrationKey)}`,
          ),
        ],
        suggestedFix: `Declare registrations.${JSON.stringify(contractName)}.<implementation>.default: true in your app's ioc.config.ts for exactly one implementation.`,
        packages: sourceIdsForSliceIndexes(
          ctx.slices,
          rows.map((r) => r.sliceIndex),
        ),
      });
    }
  }

  return issues;
};
