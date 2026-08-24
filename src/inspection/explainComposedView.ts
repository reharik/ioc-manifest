/**
 * @fileoverview The composed half of an `ioc explain` answer, projected off the SAME slices the
 * composition suite adjudicates.
 *
 * ### The gap this closes
 *
 * `explain` answered from the local package's view. In a library that is nearly the whole picture;
 * in a composing app it is nearly none of it — most cradle keys are supplied by composed packages,
 * so the command worked richly where it mattered least and read as cut off where it mattered most.
 * A developer standing in the app and asking what `mediaStorage` is got "not a key this package
 * registers", which is true of the package and useless about the container.
 *
 * ### Reuse, not a second opinion
 *
 * Every fact below already existed somewhere and none of it is re-derived here. The slices come
 * from `loadCompositionContext`, the same loader `ioc validate` and app-mode `ioc generate` build
 * their picture from. The election is `electedImplementationName` — the shared electee helper the
 * default-ambiguity and slot-occupancy checks agree through — so `explain` cannot name an electee
 * the composition suite would reject. Group membership is `buildComposedGroupKeyIndex`, the index
 * the externals check consults to recognize a grouped member's would-be key. Package naming is
 * `sliceLabel`. Freshness is the pass's own verdicts, tainting by `sourceId` exactly as it taints
 * a finding.
 *
 * This module is a PROJECTION of those onto the shape one key's explanation needs. Nothing here
 * parses a manifest, and nothing here decides anything the composition suite has already decided.
 */
import { resolveManifestAccessKey } from "../core/contractAccessKey.js";
import type {
  IocImplementationLifetime,
  IocLifetimeProvenance,
} from "../core/manifest.js";
import {
  buildComposedGroupKeyIndex,
  type ComposedGroupKeyHit,
} from "../composition/composedGroupIndex.js";
import {
  composedContractNamesSorted,
  electedImplementationName,
  groupedContractNamesAcrossSlices,
  mergedRowsForContract,
} from "../composition/checks/composedContractRows.js";
import { isLocalSlice, sliceLabel } from "../composition/sliceLabel.js";
import type {
  CompositionContext,
  ParsedGroupRoot,
  ParsedManifestSlice,
} from "../composition/types.js";
import {
  caveatNameFor,
  isStale,
  type PackageFreshness,
} from "../diagnostics/freshness.js";

/** The package an answer's fact came out of: how to print it, and how to match it. */
export type ExplainSupplier = {
  /** `@media/core`, or `@apps/api (this app)` — through {@link sliceLabel}, always. */
  readonly packageLabel: string;
  /** The machine token: a `composedManifests` entry, or `"local"`. */
  readonly sourceId: string;
  /** True when the supplier is the package the command is running in. */
  readonly local: boolean;
};

/** One registration in the composed picture, as an explanation reads it. */
export type ComposedRegistrationRow = ExplainSupplier & {
  readonly registrationKey: string;
  readonly contractName: string;
  readonly implementationName: string;
  readonly lifetime: string;
  readonly lifetimeSource?: IocLifetimeProvenance;
  /** Package-qualified for a composed unit, so two `buildReader.ts` cannot collide in the output. */
  readonly modulePath: string;
  readonly exportName: string;
  readonly dependencyKeys: readonly string[];
};

/** One group root in the composed picture, members attributed to the package supplying each. */
export type ComposedGroupRow = ExplainSupplier & {
  readonly groupKey: string;
  readonly groupKind: "collection" | "object";
  readonly baseType: string;
  readonly members: readonly {
    readonly memberName: string;
    readonly registrationKey: string;
  }[];
};

/** One key some package declares in its `IocExternals` — a demand on the composing app. */
export type ComposedExternalRow = {
  readonly key: string;
  /** The demanded type as the generated types file writes it. */
  readonly typeText: string;
  /** Every package that expects the container to already carry this key. */
  readonly demandedBy: readonly ExplainSupplier[];
};

export type ExplainComposedView = {
  /** Every registration across every slice, local first, in slice order. */
  readonly units: readonly ComposedRegistrationRow[];
  /** Contract-slot key → contract name, for every contract the composed set elects a slot for. */
  readonly slotKeys: ReadonlyMap<string, string>;
  /** Contract name → the registration key the composed election lands on. */
  readonly electedKeyByContract: ReadonlyMap<string, string>;
  /** Group root key → the merged root. */
  readonly groups: ReadonlyMap<string, ComposedGroupRow>;
  /**
   * Every key a group root accounts for — member registration keys, member contract keys, and the
   * base's would-be slot key — to the group that accounts for it.
   *
   * The membership index the externals check reads, verbatim. It is what turns "unknown key" into
   * the group law stated as an answer.
   */
  readonly groupKeyIndex: ReadonlyMap<string, ComposedGroupKeyHit>;
  readonly externals: ReadonlyMap<string, ComposedExternalRow>;
  /**
   * Packages whose manifest does not declare that it carries lifetime provenance, sorted.
   *
   * Consulted only to choose between "this unit's lifetime was not decided by anything nameable"
   * and "this package's manifest predates the field" — the difference between a real answer and a
   * guess dressed as one.
   */
  readonly packagesWithoutProvenance: readonly string[];
  /**
   * `sourceId` → the name a caveat calls that package, for every package judged stale.
   *
   * The freshness pass's own verdicts, matched the way it matches them: by machine token, never by
   * rendered prose.
   */
  readonly staleCaveatBySourceId: ReadonlyMap<string, string>;
};

const supplierOf = (slice: ParsedManifestSlice): ExplainSupplier => ({
  packageLabel: sliceLabel(slice),
  sourceId: slice.sourceId,
  local: isLocalSlice(slice),
});

/**
 * A unit's module path, qualified by the package supplying it when that is not this one.
 *
 * The same rule `ComposedManifestUnit.modulePath` follows and for the same reason: unit identity is
 * (modulePath, exportName), two packages may each hold a `buildReader.ts`, and the qualified form
 * both keeps the pair unique and tells the reader the file is not one they can open here.
 */
const qualifiedModulePath = (
  slice: ParsedManifestSlice,
  modulePath: string,
): string =>
  isLocalSlice(slice) ? modulePath : `${slice.packageLabel}/${modulePath}`;

/** Group leaves as a manifest states them, for both kinds. `members` is `unknown` on the slice. */
const membersOf = (
  root: ParsedGroupRoot,
): readonly { memberName: string; registrationKey: string }[] => {
  const isLeaf = (
    value: unknown,
  ): value is { contractName: string; registrationKey: string } =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { contractName?: unknown }).contractName === "string" &&
    typeof (value as { registrationKey?: unknown }).registrationKey === "string";

  if (Array.isArray(root.members)) {
    return root.members.filter(isLeaf).map((leaf) => ({
      memberName: leaf.contractName,
      registrationKey: leaf.registrationKey,
    }));
  }
  if (typeof root.members !== "object" || root.members === null) {
    return [];
  }
  return Object.entries(root.members as Record<string, unknown>)
    .filter((entry): entry is [string, { registrationKey: string }] =>
      isLeaf(entry[1]),
    )
    .map(([memberProperty, leaf]) => ({
      // The record's own property key, which is what a consumer writes after the group key — never
      // the member's registration key, which diverges whenever an implementation is named
      // differently from its contract.
      memberName: memberProperty,
      registrationKey: leaf.registrationKey,
    }));
};

/**
 * Group roots merged across slices.
 *
 * Members accumulate and `kind`/`baseType` come from the first declarer — the same merge
 * `composeManifests` performs at runtime and `loadComposedManifestSupply` performs for the walk.
 * A genuine disagreement between packages about a root's kind or base is a composition error, and
 * `checks/groups.ts` is what reports it; restating it inside an explanation would put the finding
 * in the wrong place.
 */
const mergeGroups = (
  ctx: CompositionContext,
): ReadonlyMap<string, ComposedGroupRow> => {
  const groups = new Map<string, ComposedGroupRow>();
  for (const slice of ctx.slices) {
    const supplier = supplierOf(slice);
    for (const [groupKey, root] of Object.entries(slice.groupRoots)) {
      const incoming = membersOf(root);
      const existing = groups.get(groupKey);
      if (existing === undefined) {
        groups.set(groupKey, {
          ...supplier,
          groupKey,
          groupKind: root.kind,
          baseType: root.baseType,
          members: incoming,
        });
        continue;
      }
      const members = [...existing.members];
      for (const member of incoming) {
        if (
          !members.some((m) => m.registrationKey === member.registrationKey)
        ) {
          members.push(member);
        }
      }
      groups.set(groupKey, { ...existing, members });
    }
  }
  return groups;
};

/**
 * Slot keys and elections, through the shared electee helpers.
 *
 * A GROUPED contract is skipped: grouped ⇒ group-only means it claims no slot key at all, so
 * offering one here would name a property the composed cradle does not carry — the same exclusion
 * the local universe already applies, applied to the merged contract set.
 */
const resolveElections = (
  ctx: CompositionContext,
): {
  slotKeys: ReadonlyMap<string, string>;
  electedKeyByContract: ReadonlyMap<string, string>;
} => {
  const slotKeys = new Map<string, string>();
  const electedKeyByContract = new Map<string, string>();
  const grouped = groupedContractNamesAcrossSlices(ctx);

  for (const contractName of composedContractNamesSorted(ctx)) {
    if (grouped.has(contractName)) {
      continue;
    }
    const metas = ctx.slices.flatMap((slice) =>
      Object.values(slice.contracts[contractName] ?? {}),
    );
    slotKeys.set(resolveManifestAccessKey(contractName, metas), contractName);

    const merged = mergedRowsForContract(ctx, contractName);
    const elected = electedImplementationName(ctx, contractName, merged);
    const electedRow =
      elected === undefined
        ? undefined
        : merged.rows.find((row) => row.implementationName === elected);
    if (electedRow !== undefined) {
      electedKeyByContract.set(contractName, electedRow.registrationKey);
    }
  }

  return { slotKeys, electedKeyByContract };
};

const collectExternals = (
  ctx: CompositionContext,
): ReadonlyMap<string, ComposedExternalRow> => {
  const externals = new Map<string, ComposedExternalRow>();
  for (const slice of ctx.slices) {
    const supplier = supplierOf(slice);
    for (const [key, { typeText }] of Object.entries(slice.externals)) {
      const existing = externals.get(key);
      externals.set(key, {
        key,
        typeText: existing?.typeText ?? typeText,
        demandedBy: [...(existing?.demandedBy ?? []), supplier],
      });
    }
  }
  return externals;
};

export type BuildExplainComposedViewInput = {
  readonly context: CompositionContext;
  /**
   * The freshness pass's verdicts, when the caller ran it.
   *
   * Optional because `explain` is a view and must survive a package whose freshness could not be
   * judged; an empty list simply produces no caveats, which is the honest outcome.
   */
  readonly freshness?: readonly PackageFreshness[];
};

export const buildExplainComposedView = (
  input: BuildExplainComposedViewInput,
): ExplainComposedView => {
  const ctx = input.context;
  const units: ComposedRegistrationRow[] = [];
  const packagesWithoutProvenance: string[] = [];

  for (const slice of ctx.slices) {
    const supplier = supplierOf(slice);
    if (!(slice.declaredFeatures ?? []).includes("lifetimeSource")) {
      packagesWithoutProvenance.push(supplier.packageLabel);
    }
    for (const [contractName, impls] of Object.entries(slice.contracts)) {
      for (const [implementationName, meta] of Object.entries(impls)) {
        units.push({
          ...supplier,
          registrationKey: meta.registrationKey,
          contractName,
          implementationName: meta.implementationName ?? implementationName,
          lifetime: (meta.lifetime ?? "singleton") satisfies
            | IocImplementationLifetime
            | string,
          ...(meta.lifetimeSource !== undefined
            ? { lifetimeSource: meta.lifetimeSource }
            : {}),
          modulePath: qualifiedModulePath(slice, meta.modulePath ?? ""),
          exportName: meta.exportName ?? implementationName,
          dependencyKeys: meta.dependencyKeys ?? [],
        });
      }
    }
  }

  const { slotKeys, electedKeyByContract } = resolveElections(ctx);

  const staleCaveatBySourceId = new Map<string, string>();
  for (const entry of input.freshness ?? []) {
    if (isStale(entry)) {
      staleCaveatBySourceId.set(entry.sourceId, caveatNameFor(entry));
    }
  }

  return {
    units,
    slotKeys,
    electedKeyByContract,
    groups: mergeGroups(ctx),
    groupKeyIndex: buildComposedGroupKeyIndex(ctx),
    externals: collectExternals(ctx),
    packagesWithoutProvenance: [...packagesWithoutProvenance].sort((a, b) =>
      a.localeCompare(b),
    ),
    staleCaveatBySourceId,
  };
};
