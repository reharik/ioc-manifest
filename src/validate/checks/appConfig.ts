import {
  IOC_CONTRACT_CONFIG_KEY,
  type IocConfig,
} from "../../config/iocConfig.js";
import type { ValidateContext, ValidationIssue } from "../types.js";

const suggestContractName = (
  unknown: string,
  candidates: readonly string[],
): string | undefined => {
  const lower = unknown.toLowerCase();
  const match = candidates.find((c) => c.toLowerCase() === lower);
  if (match !== undefined) {
    return match;
  }
  const prefix = candidates.find((c) =>
    c.toLowerCase().startsWith(lower.slice(0, 3)),
  );
  return prefix;
};

export const checkAppConfigSanity = (
  config: IocConfig,
  ctx: ValidateContext,
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const composedSet = new Set(ctx.composedPackageNames);
  const allContracts = new Set([
    ...ctx.localContractNames,
    ...ctx.composedContractNames,
  ]);
  const candidates = [...allContracts];

  if (config.registrations !== undefined) {
    for (const contract of Object.keys(config.registrations)) {
      if (allContracts.has(contract)) {
        continue;
      }
      const suggestion = suggestContractName(contract, candidates);
      const details = [
        `Known local contracts: ${[...ctx.localContractNames].sort((a, b) => a.localeCompare(b)).join(", ") || "(none)"}.`,
        `Known composed contracts: ${[...ctx.composedContractNames].sort((a, b) => a.localeCompare(b)).join(", ") || "(none)"}.`,
      ];
      if (suggestion !== undefined) {
        details.push(`Did you mean: ${JSON.stringify(suggestion)}?`);
      }
      issues.push({
        category: "app-config",
        severity: "error",
        summary: `registrations references unknown contract ${JSON.stringify(contract)}`,
        details,
        suggestedFix: `Fix the contract name in ioc.config.ts registrations, or add a factory for ${JSON.stringify(contract)}.`,
      });
    }

    for (const [contractName, perContract] of Object.entries(
      config.registrations,
    )) {
      if (typeof perContract !== "object" || perContract === null) {
        continue;
      }
      for (const [implementationName, override] of Object.entries(perContract)) {
        if (implementationName === IOC_CONTRACT_CONFIG_KEY) {
          continue;
        }
        if (
          typeof override !== "object" ||
          override === null ||
          !("source" in override)
        ) {
          continue;
        }
        const source = (override as { source?: unknown }).source;
        if (typeof source !== "string") {
          continue;
        }
        if (source === "local") {
          continue;
        }
        if (!composedSet.has(source)) {
          issues.push({
            category: "app-config",
            severity: "error",
            summary: `registrations.${contractName}.${implementationName}.source references unknown package ${JSON.stringify(source)}`,
            details: [
              `composedManifests: ${[...composedSet].map((p) => JSON.stringify(p)).join(", ") || "(none)"}`,
            ],
            suggestedFix: `Use "local" or one of the package names listed in composedManifests.`,
          });
        }
      }
    }
  }

  const aliases = config.groupBaseTypeAliases;
  if (aliases !== undefined) {
    for (const groupName of Object.keys(aliases)) {
      if (!ctx.declaredGroupNames.has(groupName)) {
        issues.push({
          category: "app-config",
          severity: "error",
          summary: `groupBaseTypeAliases references unknown group ${JSON.stringify(groupName)}`,
          details: [
            `Declared groups: ${[...ctx.declaredGroupNames].sort((a, b) => a.localeCompare(b)).join(", ") || "(none)"}`,
          ],
          suggestedFix:
            "Remove the alias entry or declare the group in this app or a composed package.",
        });
      }
    }
  }

  return issues;
};
