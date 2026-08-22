/**
 * @fileoverview Which contracts are GROUPED — the index behind "grouped ⇒ group-only".
 *
 * The law: a contract that is a member of a configured group is consumed through the group and
 * through nothing else. It has no contract-slot key, its implementations claim no individual cradle
 * keys, and nothing elects a default for it — there is no slot for a default to fill. That is the
 * symmetric twin of "scope-rooted ⇒ opener-only", and it is decided here.
 *
 * ### Why this runs before the registration plan
 *
 * The authoritative membership pass lives in `resolveGroupPlan`, and it runs AFTER the registration
 * plan because it reports members by registration key. But the plan itself now depends on the
 * answer: a grouped contract must not be put through default election at all, and election is what
 * hard-errors on a multi-implementation contract with no `default: true` — the field's two
 * `[default-ambiguity]` lines. So the membership QUESTION has to be answerable from discovery
 * alone.
 *
 * It is. Membership is a nominal-heritage relation between a contract's declared type and a group's
 * base type; neither side needs a registration plan. This index asks exactly that question, through
 * the same base-type resolution ({@link resolveGroupBaseType}), the same contract-type loader
 * ({@link getContractDeclaredTypeForMembership}) and the same predicate
 * ({@link analyzeNominalAssignability}) the authoritative pass uses. Two passes, one rule.
 *
 * Failures are silent here — an unresolvable base contributes no members and `buildGroupPlan` raises
 * the config error, once, in the place that owns it.
 */
import type * as ts from "typescript";
import type { IocLifetime } from "../config/iocConfig.js";
import {
  analyzeNominalAssignability,
  getContractDeclaredTypeForMembership,
  isNominallyAssignable,
  type ContractTypeRef,
} from "./baseTypeAssignability.js";
import { resolveGroupBaseType } from "./groupBaseType.js";
import type {
  GroupDiscoveryBuildContext,
  IocGroupKind,
  IocGroupsConfig,
} from "./resolveGroupPlan.js";

/** One contract's membership of one group, as every downstream rule needs to read it. */
export type GroupedContract = {
  contractName: string;
  /** The `ioc.config.groups` key whose base this contract declares heritage to. */
  groupName: string;
  kind: IocGroupKind;
  /** `groups.<name>.baseType`, as written in config. */
  baseType: string;
  /**
   * True when the contract IS the base — the equality-acceptance branch, where several factories
   * return the base type itself and the group is the whole of that contract's exposure. This is the
   * field's shape.
   */
  isBase: boolean;
};

/**
 * Every grouped contract in this package, plus the per-group facts the lifetime rules need.
 *
 * A contract belonging to two groups keeps the first by sorted group name; the rules below are all
 * about the FACT of membership, and none of them differ per group except the error text, which
 * names one group as the example.
 */
export type GroupedContractIndex = {
  readonly byContractName: ReadonlyMap<string, GroupedContract>;
  /**
   * Lifetime a group's BASE type declares through a `lifetimeMarkers` interface, by group name.
   *
   * Ruling 2: lifetime is a property of the group, declared on the base. Absent when the base
   * carries no marker. Consulted for provenance (`group-base-marker`) and by the member-declaration
   * check, which is exactly "the member carries a marker the base does not".
   */
  readonly baseMarkerLifetimeByGroup: ReadonlyMap<string, IocLifetime>;
};

export const EMPTY_GROUPED_CONTRACT_INDEX: GroupedContractIndex = {
  byContractName: new Map(),
  baseMarkerLifetimeByGroup: new Map(),
};

/** True when the contract is a member of some configured group. */
export const isGroupedContract = (
  index: GroupedContractIndex,
  contractName: string,
): boolean => index.byContractName.has(contractName);

export type ResolveGroupedContractsOptions = {
  /** Resolved `lifetimeMarkers` types, when the config declares any. */
  readonly markers?: readonly { name: string; lifetime: IocLifetime; type: ts.Type }[];
};

/**
 * Builds the index from config groups and the contracts discovery found.
 *
 * `contracts` is intentionally the narrow {@link ContractTypeRef} shape: everything needed is on a
 * `DiscoveredFactory`, so the index is available from the moment discovery finishes.
 */
export const resolveGroupedContracts = (
  groups: IocGroupsConfig | undefined,
  contracts: readonly ContractTypeRef[],
  discovery: GroupDiscoveryBuildContext | undefined,
  options?: ResolveGroupedContractsOptions,
): GroupedContractIndex => {
  if (groups === undefined || discovery === undefined) {
    return EMPTY_GROUPED_CONTRACT_INDEX;
  }

  const checker = discovery.program.getTypeChecker();
  const byContractName = new Map<string, GroupedContract>();
  const baseMarkerLifetimeByGroup = new Map<string, IocLifetime>();

  // One contract may be discovered under several implementations; the type is per contract NAME.
  const contractByName = new Map<string, ContractTypeRef>();
  for (const contract of contracts) {
    if (!contractByName.has(contract.contractName)) {
      contractByName.set(contract.contractName, contract);
    }
  }

  for (const groupName of Object.keys(groups).sort((a, b) =>
    a.localeCompare(b),
  )) {
    const entry = groups[groupName];
    if (
      entry === undefined ||
      typeof entry.baseType !== "string" ||
      entry.baseType.length === 0
    ) {
      continue;
    }

    const base = resolveGroupBaseType(checker, discovery, entry.baseType);
    if (!base.ok) {
      continue;
    }

    for (const marker of options?.markers ?? []) {
      if (isNominallyAssignable(checker, base.type, marker.type)) {
        baseMarkerLifetimeByGroup.set(groupName, marker.lifetime);
        break;
      }
    }

    // The base is grouped by definition — it is the family's own name — and it is registered here
    // even when no local factory returns it. That is what lets a demand for the base's would-be
    // contract key be diagnosed as the group mistake it is rather than drifting out as an external.
    if (!byContractName.has(entry.baseType)) {
      byContractName.set(entry.baseType, {
        contractName: entry.baseType,
        groupName,
        kind: entry.kind,
        baseType: entry.baseType,
        isBase: true,
      });
    }

    for (const [contractName, contract] of contractByName) {
      if (byContractName.has(contractName)) {
        continue;
      }
      const contractType = getContractDeclaredTypeForMembership(
        checker,
        discovery.program,
        discovery.generatedDir,
        discovery.scanDirs,
        contract,
      );
      if (contractType === undefined) {
        continue;
      }
      if (!analyzeNominalAssignability(checker, contractType, base.type).assignable) {
        continue;
      }
      byContractName.set(contractName, {
        contractName,
        groupName,
        kind: entry.kind,
        baseType: entry.baseType,
        isBase: contractName === entry.baseType,
      });
    }
  }

  return { byContractName, baseMarkerLifetimeByGroup };
};

/**
 * Whether a contract's own declared type carries a lifetime marker the group's base does NOT.
 *
 * This is the whole of the member-level-declaration test, and it is deliberately a comparison
 * rather than a path trace. Transitive heritage means a member that extends a marked base also
 * "carries" the marker; the only thing that distinguishes a member DECLARING one is the base not
 * having it. A member that redundantly restates the base's own marker is indistinguishable from one
 * that merely inherits it, and is treated as inheriting — the base owns the lifetime either way, so
 * there is nothing the restatement could change.
 */
export const memberDeclaredMarkers = (
  checker: ts.TypeChecker,
  contractType: ts.Type,
  baseType: ts.Type,
  markers: readonly { name: string; lifetime: IocLifetime; type: ts.Type }[],
): { name: string; lifetime: IocLifetime }[] =>
  markers
    .filter(
      (marker) =>
        isNominallyAssignable(checker, contractType, marker.type) &&
        !isNominallyAssignable(checker, baseType, marker.type),
    )
    .map((marker) => ({ name: marker.name, lifetime: marker.lifetime }));
