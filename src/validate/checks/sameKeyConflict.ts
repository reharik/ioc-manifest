import { LOCAL_PACKAGE_IDENTIFIER } from "../../config/packageIdentifier.js";
import type { ValidateContext, ValidationIssue } from "../types.js";

type KeyOwner = {
  readonly packageLabel: string;
  readonly sliceIndex: number;
  readonly contractName: string;
  readonly implementationName: string;
};

const buildIndexForSource = (
  ctx: ValidateContext,
): ((source: string) => number) | undefined => {
  const packages = ctx.overrides?.composedPackageNames;
  if (packages === undefined) {
    return undefined;
  }
  const indexByPackage = new Map<string, number>();
  packages.forEach((pkg, i) => {
    indexByPackage.set(pkg, i + 1);
  });
  return (source: string): number => {
    if (source === LOCAL_PACKAGE_IDENTIFIER || source === "local") {
      return 0;
    }
    return indexByPackage.get(source) ?? -1;
  };
};

const resolveWinnerIndex = (
  owners: readonly KeyOwner[],
  ctx: ValidateContext,
  indexForSource: ((source: string) => number) | undefined,
): number | undefined => {
  if (indexForSource === undefined || ctx.overrides?.contracts === undefined) {
    return undefined;
  }

  const winners = new Set<number>();
  for (const owner of owners) {
    const source =
      ctx.overrides?.contracts?.[owner.contractName]?.sourceOverride?.[
        owner.implementationName
      ];
    if (source === undefined) {
      continue;
    }
    const idx = indexForSource(source);
    if (idx >= 0) {
      winners.add(idx);
    }
  }

  if (winners.size === 1) {
    return [...winners][0];
  }
  return undefined;
};

export const checkSameKeyConflicts = (
  ctx: ValidateContext,
): ValidationIssue[] => {
  const keyOwners = new Map<string, KeyOwner[]>();
  const indexForSource = buildIndexForSource(ctx);

  ctx.slices.forEach((slice, sliceIndex) => {
    for (const [contractName, impls] of Object.entries(slice.contracts)) {
      for (const [implementationName, meta] of Object.entries(impls)) {
        const key = meta.registrationKey;
        const owner: KeyOwner = {
          packageLabel: slice.packageLabel,
          sliceIndex,
          contractName,
          implementationName,
        };
        const list = keyOwners.get(key) ?? [];
        list.push(owner);
        keyOwners.set(key, list);
      }
    }

  });

  const issues: ValidationIssue[] = [];

  for (const [key, owners] of keyOwners) {
    if (owners.length <= 1) {
      continue;
    }

    if (resolveWinnerIndex(owners, ctx, indexForSource) !== undefined) {
      continue;
    }

    const sorted = [...owners].sort((a, b) => a.sliceIndex - b.sliceIndex);
    const a = sorted[0]!;
    const b = sorted[1]!;

    issues.push({
      category: "same-key-conflict",
      severity: "error",
      summary: `Conflicting registration key ${JSON.stringify(key)} across manifests`,
      details: owners.map(
        (o) =>
          `- ${o.packageLabel}: contract ${o.contractName}, implementation ${o.implementationName}`,
      ),
      suggestedFix: `Declare registrations.${a.contractName}.${a.implementationName}.source or registrations.${b.contractName}.${b.implementationName}.source in your app's ioc.config.ts as "local" or a package from composedManifests.`,
    });
  }

  return issues;
};
