import { selectDefaultImplementationName } from "../../core/defaultImplementationSelection.js";
import { contractNameToDefaultRegistrationKey } from "../../generator/naming.js";
import type { ValidateContext, ValidationIssue } from "../types.js";

type MergedImplRow = {
  readonly packageLabel: string;
  readonly sliceIndex: number;
  readonly implementationName: string;
  readonly registrationKey: string;
  readonly default?: boolean;
};

export const checkDefaultAmbiguity = (
  ctx: ValidateContext,
): ValidationIssue[] => {
  const contractNames = new Set<string>();
  for (const slice of ctx.slices) {
    for (const name of Object.keys(slice.contracts)) {
      contractNames.add(name);
    }
  }

  const issues: ValidationIssue[] = [];

  for (const contractName of [...contractNames].sort((a, b) =>
    a.localeCompare(b),
  )) {
    const appDefault =
      ctx.overrides?.contracts?.[contractName]?.defaultImplementation;
    if (appDefault !== undefined) {
      continue;
    }

    const rows: MergedImplRow[] = [];
    const manifestDefaults: {
      packageLabel: string;
      sliceIndex: number;
      implementationName: string;
    }[] = [];

    ctx.slices.forEach((slice, sliceIndex) => {
      const impls = slice.contracts[contractName];
      if (impls === undefined) {
        return;
      }
      for (const [implementationName, meta] of Object.entries(impls)) {
        rows.push({
          packageLabel: slice.packageLabel,
          sliceIndex,
          implementationName,
          registrationKey: meta.registrationKey,
          ...(meta.default === true ? { default: true as const } : {}),
        });
        if (meta.default === true) {
          manifestDefaults.push({
            packageLabel: slice.packageLabel,
            sliceIndex,
            implementationName,
          });
        }
      }
    });

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
      });
    }
  }

  return issues;
};
