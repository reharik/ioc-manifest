/**
 * @fileoverview Which cradle keys belong to a group somebody in this composition declares.
 *
 * ### The mirror of the codegen rule
 *
 * Generation refuses a demand for a grouped member and says why (`grouped-member-demand`). Validate
 * reads COMMITTED artifacts, so it meets the same mistake in a different disguise: an app whose
 * `IocExternals` predates a library's regrouping demands a key that no manifest supplies any more,
 * and the externals check — correct that nothing supplies it — offered the generic remedy, "register
 * a factory for it in this app". For a grouped member that remedy is a shadow registration of
 * somebody else's family member: the one thing the group law exists to forbid.
 *
 * The fact needed to say something better is already in every slice. A generated manifest states
 * its group roots in full, `buildCompositionSlice` keeps them verbatim (members and their contract
 * names included), and composition merges them. This module turns those roots into the lookup the
 * externals check wants: given an unsatisfied key, is it a group's business, and whose group?
 *
 * ### The three ways a key can name a group's business
 *
 * A reader who has learned that grouped members have no keys tries the next plausible spelling, so
 * all three are recognized and all three get the same answer:
 *
 * 1. a member's **registration key** — what a bare demand for the implementation spells;
 * 2. a member's **contract key** — the record property a record group exposes it under, and the
 *    would-be slot key of the member's contract, which are the same camel-cased name;
 * 3. the group **base's** would-be slot key — the family's own name, reached for last.
 *
 * Registration keys win where a key is claimed twice: it is the most specific statement, and it is
 * the one the container would actually have resolved before the contract was grouped.
 */
import { contractNameToDefaultRegistrationKey } from "../generator/naming.js";
import { sliceLabel, isLocalSlice } from "./sliceLabel.js";
import type { CompositionContext, ParsedGroupRoot } from "./types.js";

/** What the externals check needs to know about a key that is a group's business. */
export type ComposedGroupKeyHit = {
  /** The group root's cradle key — what a legal demand names instead. */
  readonly groupKey: string;
  readonly kind: "collection" | "object";
  readonly baseType: string;
  /** Rendered label of the package whose manifest declares this root. */
  readonly declaredBy: string;
  /**
   * The machine token for that package — its `composedManifests` entry, or `"local"`.
   *
   * Beside the rendered label rather than instead of it: the label is prose and belongs in the
   * finding's sentence, while the freshness pass has to know WHICH package's artifacts a finding
   * rests on, and a group root is one of the things a finding rests on.
   */
  readonly declaredBySourceId: string;
  /** True when that package is composed rather than the one being validated. */
  readonly declaredByComposedPackage: boolean;
  /** The member contract this key names, when the key names a member rather than the base. */
  readonly contractName?: string;
  /**
   * Record-kind groups expose members as properties of the group value; this is that property.
   *
   * It is the record's own KEY, never the member's registration key — `registerGroups` builds the
   * group value from these keys and resolves each value from the registration key, so they diverge
   * whenever an implementation is named differently from its contract.
   */
  readonly memberProperty?: string;
};

/** Group leaves as a manifest states them, narrowed from the slice's `unknown` members payload. */
type GroupLeaf = { contractName: string; registrationKey: string };

const isGroupLeaf = (value: unknown): value is GroupLeaf =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as GroupLeaf).contractName === "string" &&
  typeof (value as GroupLeaf).registrationKey === "string";

/**
 * Members of a root as `[recordProperty | undefined, leaf]` pairs, for both group kinds.
 *
 * A collection group has no property names — its members are individually anonymous by
 * declaration — so the first element is `undefined` there, and the guidance says so rather than
 * inventing a name.
 */
const membersOf = (
  root: ParsedGroupRoot,
): readonly [string | undefined, GroupLeaf][] => {
  const members = root.members;
  if (Array.isArray(members)) {
    return members
      .filter(isGroupLeaf)
      .map((leaf) => [undefined, leaf] as [string | undefined, GroupLeaf]);
  }
  if (typeof members !== "object" || members === null) {
    return [];
  }
  return Object.entries(members as Record<string, unknown>)
    .filter((entry): entry is [string, GroupLeaf] => isGroupLeaf(entry[1]))
    .map(([property, leaf]) => [property, leaf]);
};

/**
 * Every key any slice's group roots account for, to the group that accounts for it.
 *
 * Built once per run and consulted per unsatisfied external. First writer wins, and the insertion
 * order below is the precedence: registration keys, then contract keys, then base slot keys.
 */
export const buildComposedGroupKeyIndex = (
  ctx: CompositionContext,
): ReadonlyMap<string, ComposedGroupKeyHit> => {
  const byRegistrationKey = new Map<string, ComposedGroupKeyHit>();
  const byContractKey = new Map<string, ComposedGroupKeyHit>();
  const byBaseKey = new Map<string, ComposedGroupKeyHit>();

  for (const slice of ctx.slices) {
    const declaredBy = sliceLabel(slice);
    const declaredBySourceId = slice.sourceId;
    const declaredByComposedPackage = !isLocalSlice(slice);

    for (const [groupKey, root] of Object.entries(slice.groupRoots)) {
      const base = {
        groupKey,
        kind: root.kind,
        baseType: root.baseType,
        declaredBy,
        declaredBySourceId,
        declaredByComposedPackage,
      } as const;

      for (const [memberProperty, leaf] of membersOf(root)) {
        const hit: ComposedGroupKeyHit = {
          ...base,
          contractName: leaf.contractName,
          ...(memberProperty !== undefined ? { memberProperty } : {}),
        };
        if (!byRegistrationKey.has(leaf.registrationKey)) {
          byRegistrationKey.set(leaf.registrationKey, hit);
        }
        // The record property IS the contract key; deriving it as well costs nothing and covers a
        // collection group, whose members have no property but still have a would-be slot key.
        for (const contractKey of [
          memberProperty,
          contractNameToDefaultRegistrationKey(leaf.contractName),
        ]) {
          if (contractKey !== undefined && !byContractKey.has(contractKey)) {
            byContractKey.set(contractKey, hit);
          }
        }
      }

      const baseKey = contractNameToDefaultRegistrationKey(root.baseType);
      if (!byBaseKey.has(baseKey)) {
        byBaseKey.set(baseKey, base);
      }
    }
  }

  const merged = new Map<string, ComposedGroupKeyHit>(byBaseKey);
  for (const [key, hit] of byContractKey) {
    merged.set(key, hit);
  }
  for (const [key, hit] of byRegistrationKey) {
    merged.set(key, hit);
  }
  return merged;
};
