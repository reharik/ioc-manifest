/**
 * @fileoverview Group membership carried in by COMPOSED manifests, in the terms the demand rule
 * reads it.
 *
 * ### Why this exists
 *
 * "Grouped ⇒ group-only" is decided by `groups/groupedContracts.ts`, which walks nominal heritage
 * over SOURCE against `config.groups`. That answer is necessarily package-local: a composing app
 * has neither the library's sources nor the library's `ioc.config.ts`, so a contract that is a
 * member of a group declared in another package is invisible to it. The consequence was a demand
 * for a composed member landing on `[named-marker-required]` at codegen — whose advice, "write
 * `Named<MemberContract>`", is a spelling the group law forbids — and then, once written, drifting
 * out as an unsatisfied `[externals]` key in `ioc validate`. Two diagnostics, neither of them the
 * rule that was actually broken.
 *
 * The fact was never missing, only unread. Every generated manifest states its group roots in full
 * (see the schema note on {@link ComposedGroupRoot}), and `loadComposedManifestSupply` already
 * merges them across packages exactly as `composeManifests` will at runtime. This module projects
 * those roots onto the two maps the demand rule consults, so the four doors —
 * bare member key, `Named<MemberContract>`, `Named<GroupBase>`, and the member's would-be contract
 * key — recognize a composed member the same way they already recognize a local one.
 *
 * ### What this does NOT do
 *
 * It does not extend the law. A composed group is exactly as group-only as a local one was before,
 * and no new spelling becomes legal or illegal; what changes is only which memberships the existing
 * rule can see.
 */
import { contractNameToDefaultRegistrationKey } from "./naming.js";
import type { DemandGroupMembership } from "./analyzeDemandSupply/namedInstanceDemand.js";
import type {
  ComposedGroupRoot,
  ComposedManifestSupply,
} from "./loadComposedManifestUnits.js";

/** The two demand-time indexes, derived together because they come from the same roots. */
export type ComposedGroupDemandIndex = {
  /** Grouped contract name → its membership, for every contract a composed root names. */
  readonly membershipByContractName: ReadonlyMap<string, DemandGroupMembership>;
  /** Would-be contract key → the grouped contract name it would have belonged to. */
  readonly absentSlotKeyToContractName: ReadonlyMap<string, string>;
};

export const EMPTY_COMPOSED_GROUP_DEMAND_INDEX: ComposedGroupDemandIndex = {
  membershipByContractName: new Map(),
  absentSlotKeyToContractName: new Map(),
};

/**
 * Every contract one composed root makes grouped, with the property each is exposed under.
 *
 * The BASE is included alongside the members, and for the same reason `resolveGroupedContracts`
 * includes it locally: the base is the family's own name, so a demand for ITS would-be contract key
 * is the group mistake too, and a base nothing implements simply contributes a name nothing
 * matches. A member whose contract IS the base — the equality-acceptance shape, which is what a
 * collection group over one contract looks like — keeps the member's own property.
 */
const membershipsForRoot = (
  root: ComposedGroupRoot,
): readonly [string, DemandGroupMembership][] => {
  const membership = (
    memberProperty: string | undefined,
  ): DemandGroupMembership => ({
    groupName: root.groupKey,
    kind: root.kind,
    baseType: root.baseType,
    groupKey: root.groupKey,
    ...(memberProperty !== undefined ? { memberProperty } : {}),
  });

  const rows: [string, DemandGroupMembership][] = root.members.map((member) => [
    member.contractName,
    membership(member.memberProperty),
  ]);

  if (!root.members.some((member) => member.contractName === root.baseType)) {
    rows.push([root.baseType, membership(undefined)]);
  }

  return rows;
};

/**
 * Projects merged composed group roots onto the demand rule's indexes.
 *
 * First writer wins on a contract claimed by two roots, matching the local index's own rule (a
 * contract belonging to two groups keeps the first): every rule downstream is about the FACT of
 * membership, and only the error text names one group as the example.
 */
export const buildComposedGroupDemandIndex = (
  supply: ComposedManifestSupply | undefined,
): ComposedGroupDemandIndex => {
  if (supply === undefined || supply.groupRootsByGroupKey.size === 0) {
    return EMPTY_COMPOSED_GROUP_DEMAND_INDEX;
  }

  const membershipByContractName = new Map<string, DemandGroupMembership>();
  const absentSlotKeyToContractName = new Map<string, string>();

  for (const root of supply.groupRootsByGroupKey.values()) {
    for (const [contractName, membership] of membershipsForRoot(root)) {
      if (membershipByContractName.has(contractName)) {
        continue;
      }
      membershipByContractName.set(contractName, membership);
      absentSlotKeyToContractName.set(
        contractNameToDefaultRegistrationKey(contractName),
        contractName,
      );
    }
  }

  return { membershipByContractName, absentSlotKeyToContractName };
};

/**
 * Local memberships over composed ones, wherever both name a contract.
 *
 * The same precedence every other composed/local merge in the generator applies: a local answer
 * came from this package's own sources and config, which is the more specific statement, and a
 * genuine disagreement between the two is a composition error that `checks/groups.ts` reports.
 */
export const mergeWithLocalPrecedence = <TValue>(
  local: ReadonlyMap<string, TValue>,
  composed: ReadonlyMap<string, TValue>,
): ReadonlyMap<string, TValue> => {
  if (composed.size === 0) {
    return local;
  }
  const merged = new Map<string, TValue>(composed);
  for (const [key, value] of local) {
    merged.set(key, value);
  }
  return merged;
};
