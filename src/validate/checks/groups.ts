import { areCanonicalBaseTypeIdsEquivalent } from "../../runtime/groupBaseTypeEquivalence.js";
import { LOCAL_PACKAGE_IDENTIFIER } from "../../config/packageIdentifier.js";
import type { ParsedGroupRoot, ValidateContext, ValidationIssue } from "../types.js";

type GroupContributor = {
  readonly packageLabel: string;
  readonly sliceIndex: number;
  readonly root: ParsedGroupRoot;
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

const resolveObjectGroupKeyWinner = (
  ctx: ValidateContext,
  key: string,
  indexForSource: ((source: string) => number) | undefined,
): number | undefined => {
  if (indexForSource === undefined) {
    return undefined;
  }
  const owners = ctx.slices.flatMap((slice, sliceIndex) =>
    Object.entries(slice.contracts).flatMap(([contractName, impls]) =>
      Object.entries(impls)
        .filter(([, meta]) => meta.registrationKey === key)
        .map(([implementationName]) => ({
          sliceIndex,
          contractName,
          implementationName,
        })),
    ),
  );
  if (owners.length < 2) {
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

export const checkGroupConsistency = (
  ctx: ValidateContext,
): ValidationIssue[] => {
  const byGroup = new Map<string, GroupContributor[]>();
  const aliasSets = ctx.overrides?.groups?.baseTypeAliases;
  const indexForSource = buildIndexForSource(ctx);
  const issues: ValidationIssue[] = [];

  ctx.slices.forEach((slice, sliceIndex) => {
    for (const [groupName, root] of Object.entries(slice.groupRoots)) {
      const list = byGroup.get(groupName) ?? [];
      list.push({ packageLabel: slice.packageLabel, sliceIndex, root });
      byGroup.set(groupName, list);
    }
  });

  for (const [groupName, contributors] of byGroup) {
    if (contributors.length <= 1) {
      continue;
    }

    const first = contributors[0]!;
    for (const other of contributors.slice(1)) {
      if (first.root.kind !== other.root.kind) {
        issues.push({
          category: "group-kind",
          severity: "error",
          summary: `Group ${JSON.stringify(groupName)} has mismatched kinds across manifests`,
          details: [
            `- ${first.packageLabel}: kind ${JSON.stringify(first.root.kind)}`,
            `- ${other.packageLabel}: kind ${JSON.stringify(other.root.kind)}`,
          ],
          suggestedFix:
            "Ensure every composed package declares the same groups.<name>.kind in ioc.config.ts.",
        });
      }

      if (
        !areCanonicalBaseTypeIdsEquivalent(
          first.root.baseTypeId,
          other.root.baseTypeId,
          groupName,
          aliasSets,
        )
      ) {
        issues.push({
          category: "group-base-type",
          severity: "error",
          summary: `Group ${JSON.stringify(groupName)} has mismatched base types across manifests`,
          details: [
            `- ${first.packageLabel}: baseType ${JSON.stringify(first.root.baseType)} (id: ${JSON.stringify(first.root.baseTypeId)})`,
            `- ${other.packageLabel}: baseType ${JSON.stringify(other.root.baseType)} (id: ${JSON.stringify(other.root.baseTypeId)})`,
          ],
          suggestedFix: [
            "If these are the same logical type (e.g. hoisting issue), add to ioc.config.ts:",
            "  groupBaseTypeAliases: {",
            `    ${JSON.stringify(groupName)}: [${JSON.stringify(first.root.baseTypeId)}, ${JSON.stringify(other.root.baseTypeId)}],`,
            "  }",
          ].join("\n"),
        });
      }
    }

    if (first.root.kind !== "object") {
      continue;
    }

    const memberKeyOwners = new Map<
      string,
      { packageLabel: string; sliceIndex: number; registrationKey: string }[]
    >();

    for (const contributor of contributors) {
      const members = contributor.root.members;
      if (typeof members !== "object" || members === null || Array.isArray(members)) {
        continue;
      }
      for (const [memberKey, leaf] of Object.entries(
        members as Record<string, { registrationKey?: string }>,
      )) {
        const regKey = leaf.registrationKey ?? memberKey;
        const list = memberKeyOwners.get(memberKey) ?? [];
        list.push({
          packageLabel: contributor.packageLabel,
          sliceIndex: contributor.sliceIndex,
          registrationKey: regKey,
        });
        memberKeyOwners.set(memberKey, list);
      }
    }

    for (const [memberKey, owners] of memberKeyOwners) {
      if (owners.length <= 1) {
        continue;
      }
      const winner = resolveObjectGroupKeyWinner(
        ctx,
        owners[0]!.registrationKey,
        indexForSource,
      );
      if (winner !== undefined) {
        continue;
      }

      issues.push({
        category: "group-key-conflict",
        severity: "error",
        summary: `Object group ${JSON.stringify(groupName)} has duplicate key ${JSON.stringify(memberKey)} across manifests`,
        details: owners.map((o) => `- ${o.packageLabel}`),
        suggestedFix:
          "Resolve via registrations.<Contract>.<implementation>.source in your app's ioc.config.ts.",
      });
    }
  }

  return issues;
};
