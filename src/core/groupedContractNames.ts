/**
 * @fileoverview Which contracts are grouped, read from a generated manifest's group roots.
 *
 * The generation-time answer comes from a nominal-heritage walk over source
 * (`groups/groupedContracts.ts`). Runtime and `ioc validate` have no sources — they have the
 * manifest — so they read the same fact off what generation WROTE: every group root names its base
 * type, and every member leaf names the contract it came from.
 *
 * That is a complete record. A contract is grouped exactly when it is some group's base or supplies
 * some group's member, and both are on the group root. Nothing here re-derives membership; it
 * reads it.
 */
import type {
  IocGroupLeafManifest,
  IocGroupNodeManifest,
  IocGroupsManifest,
} from "./manifest.js";

/** Member leaves of a group node, for both kinds (array and record). */
const groupMemberLeaves = (
  members: IocGroupNodeManifest,
): readonly IocGroupLeafManifest[] =>
  Array.isArray(members)
    ? members
    : Object.values(members as Record<string, IocGroupLeafManifest>);

/**
 * Contract names that are grouped: every group root's `baseType`, plus every member's
 * `contractName`.
 *
 * The base is included even when no implementation of it was discovered locally. A base that is
 * itself a registered contract is the equality-acceptance shape and is already a member; a base
 * that is not registered contributes a name nothing matches, which costs nothing and keeps the rule
 * stated once.
 */
export const groupedContractNamesFromManifest = (
  groupsManifest: IocGroupsManifest | undefined,
): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const root of Object.values(groupsManifest ?? {})) {
    names.add(root.baseType);
    for (const leaf of groupMemberLeaves(root.members)) {
      names.add(leaf.contractName);
    }
  }
  return names;
};

/** Registration keys claimed by group members — the keys that are group-only, not cradle keys. */
export const groupedMemberRegistrationKeysFromManifest = (
  groupsManifest: IocGroupsManifest | undefined,
): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const root of Object.values(groupsManifest ?? {})) {
    for (const leaf of groupMemberLeaves(root.members)) {
      keys.add(leaf.registrationKey);
    }
  }
  return keys;
};
