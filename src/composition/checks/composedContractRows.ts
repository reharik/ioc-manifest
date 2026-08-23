/**
 * @fileoverview The composed view of one contract: every implementation across every slice, and
 * who — if anyone — is elected.
 *
 * Composition merges contracts, so the facts the default-slot rules adjudicate are facts about the
 * merged set, not about any one manifest. Two checks read that merged view — `default-ambiguity`
 * and `slot-occupancy` — and they must agree about who the electee is, or one would report a
 * conflict the other has already resolved.
 */
import { selectDefaultImplementationName } from "../../core/defaultImplementationSelection.js";
import { sliceLabel } from "../sliceLabel.js";
import type { CompositionContext } from "../types.js";

export type MergedImplRow = {
  readonly packageLabel: string;
  readonly sliceIndex: number;
  readonly implementationName: string;
  readonly registrationKey: string;
  readonly default?: boolean;
};

/**
 * Contracts that are grouped anywhere in the composed set.
 *
 * Read off the group roots each manifest carries, the same record runtime reads. Composition merges
 * group roots across manifests, so a contract grouped in ANY slice is grouped for the composed
 * container — which is the scope these checks adjudicate.
 */
export const groupedContractNamesAcrossSlices = (
  ctx: CompositionContext,
): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const slice of ctx.slices) {
    for (const root of Object.values(slice.groupRoots)) {
      names.add(root.baseType);
      for (const leaf of groupMemberLeaves(root.members)) {
        if (typeof leaf?.contractName === "string") {
          names.add(leaf.contractName);
        }
      }
    }
  }
  return names;
};

/** Member leaves of a parsed group node, for both kinds. `members` is `unknown` on the slice. */
const groupMemberLeaves = (
  members: unknown,
): readonly { contractName?: unknown }[] => {
  if (Array.isArray(members)) {
    return members as { contractName?: unknown }[];
  }
  if (typeof members === "object" && members !== null) {
    return Object.values(members) as { contractName?: unknown }[];
  }
  return [];
};

/** Every contract name any slice declares, sorted for stable reporting. */
export const composedContractNamesSorted = (
  ctx: CompositionContext,
): string[] => {
  const contractNames = new Set<string>();
  for (const slice of ctx.slices) {
    for (const name of Object.keys(slice.contracts)) {
      contractNames.add(name);
    }
  }
  return [...contractNames].sort((a, b) => a.localeCompare(b));
};

export type MergedContractRows = {
  readonly rows: readonly MergedImplRow[];
  /** Implementations a MANIFEST marks `default: true`, one entry per declaring slice. */
  readonly manifestDefaults: readonly {
    readonly packageLabel: string;
    readonly sliceIndex: number;
    readonly implementationName: string;
  }[];
};

export const mergedRowsForContract = (
  ctx: CompositionContext,
  contractName: string,
): MergedContractRows => {
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
        packageLabel: sliceLabel(slice),
        sliceIndex,
        implementationName,
        registrationKey: meta.registrationKey,
        ...(meta.default === true ? { default: true as const } : {}),
      });
      if (meta.default === true) {
        manifestDefaults.push({
          packageLabel: sliceLabel(slice),
          sliceIndex,
          implementationName,
        });
      }
    }
  });

  return { rows, manifestDefaults };
};

/**
 * Who the composed container will hand out under this contract's slot key, or `undefined` when
 * nobody can be named.
 *
 * `undefined` means the election itself is broken — several manifest defaults, or an ambiguity
 * `selectDefaultImplementationName` refuses to resolve. `default-ambiguity` reports exactly those
 * states, so any check reading this treats `undefined` as "already reported, nothing to add".
 */
export const electedImplementationName = (
  ctx: CompositionContext,
  contractName: string,
  merged: MergedContractRows,
): string | undefined => {
  const appDefault =
    ctx.overrides?.contracts?.[contractName]?.defaultImplementation;
  if (appDefault !== undefined) {
    return appDefault;
  }
  if (merged.manifestDefaults.length > 1 || merged.rows.length === 0) {
    return undefined;
  }
  try {
    return selectDefaultImplementationName(
      contractName,
      merged.rows.map((r) => ({
        implementationName: r.implementationName,
        registrationKey: r.registrationKey,
        ...(r.default === true ? { default: true as const } : {}),
      })),
    );
  } catch {
    return undefined;
  }
};
