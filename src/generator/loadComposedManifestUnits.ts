/**
 * @fileoverview Reads composed package manifests as SUPPLY for the scope-root subtree walk.
 *
 * The other composed loaders in this directory each answer one narrow question — which contract
 * names exist, which group roots exist, which opener keys are claimed. This one answers the
 * question a demand WALK asks: given a cradle key, what unit supplies it, and what does that unit
 * itself demand? A composing app cannot answer that from its own discovery, because the units live
 * in another package and were compiled by another run of the generator.
 *
 * What it reconstructs is precisely what `registerIocFromManifest` will register from the same
 * file — implementation keys, contract default-slot aliases, and group roots — so the walk's idea
 * of the container matches the container that will actually exist. It is read the way every other
 * composed loader reads: a fresh parse of the generated manifest SOURCE, never an import of it.
 *
 * ### Degraded mode
 *
 * `dependencyKeys` is a recent addition (see `ModuleFactoryManifestMetadata`). A manifest generated
 * before it exists carries no demand edges at all, and there is no way to recover them from here —
 * the sources are in another package and may not even be present. Such a package is reported by
 * name in {@link ComposedManifestSupply.packagesWithoutDependencyData} so its callers can say so
 * out loud rather than return a confident verdict over a subtree they could not see.
 */
import fs from "node:fs";
import type {
  IocGroupKind,
  IocGroupLeafManifest,
  IocGroupNodeManifest,
  IocGroupRootManifest,
  IocImplementationLifetime,
  IocLifetimeProvenance,
} from "../core/manifest.js";
import { resolveManifestAccessKey } from "../core/contractAccessKey.js";
import { parseGeneratedManifestSource } from "./parseGeneratedManifestSource.js";
import { resolvePackageExportPath } from "./resolveComposedPackageExport.js";
import type { ComposedManifestContractNames } from "./loadComposedManifestContracts.js";

/**
 * One registration unit carried in by a composed package manifest.
 *
 * `modulePath` is PACKAGE-QUALIFIED (`@scope/lib/services/buildReader.ts`) rather than the raw
 * package-relative path the manifest stores. Unit identity across the whole generator is the pair
 * (modulePath, exportName), and two packages may perfectly well each hold a `buildReader.ts`; the
 * qualified form keeps that pair unique and doubles as the thing error messages should print.
 */
export type ComposedManifestUnit = {
  /** The composed package this unit came from, as written in `config.composedManifests`. */
  packageName: string;
  contractName: string;
  implementationName: string;
  registrationKey: string;
  exportName: string;
  /** Package-qualified module path — see the note above. */
  modulePath: string;
  lifetime: IocImplementationLifetime;
  /**
   * WHICH MECHANISM decided {@link lifetime}, when the manifest records it.
   *
   * `undefined` means "not recorded" and never "nothing decided it" — the same ambiguity
   * {@link dependencyKeys} has, answered the same way, by
   * {@link ComposedManifestSupply.packagesWithoutLifetimeProvenance}. Surfaced here and consumed by
   * `ioc explain`; nothing in the walk reads it, and nothing in the walk should.
   */
  lifetimeSource?: IocLifetimeProvenance;
  /** True when the manifest marked this implementation the contract's default. */
  isDefault: boolean;
  /**
   * Cradle keys this unit demands, when the manifest carries them.
   *
   * `undefined` means "not known" and never "none": a unit whose manifest predates the field and a
   * unit that genuinely demands nothing are indistinguishable here, which is exactly why
   * {@link ComposedManifestSupply.packagesWithoutDependencyData} exists.
   */
  dependencyKeys?: readonly string[];
};

/**
 * One member of a composed package's group root, in the terms a DEMAND-time check reads it.
 *
 * Both facts a demand needs are carried: the registration key (what a bare or `Named<…>` demand
 * spells) and the contract name (what the member's would-be contract key is derived from, and what
 * the grouped-member error names). The generated manifest states both on every leaf — see the
 * schema note on {@link ComposedGroupRoot}.
 */
export type ComposedGroupMember = {
  contractName: string;
  registrationKey: string;
  /**
   * Record-kind groups expose members as properties of the group value; this is the property name.
   * Absent for a collection group, whose members are individually anonymous by declaration.
   */
  memberProperty?: string;
};

/**
 * A composed package's group root, merged across every package that contributes to the key.
 *
 * ### The schema carries membership, always
 *
 * `IocGroupRootManifest` declares `kind`, `baseType` and `members` as required, and
 * `IocGroupLeafManifest` declares `contractName` and `registrationKey` as required — none of them
 * is an "omitted when empty" field, so there is no `dependencyKeys`-shaped ambiguity here and no
 * feature declaration to consult. Schema v2 manifests are refused outright by the composition
 * suite's version check, so no reader of an older shape exists. A root the parser cannot read as a
 * root (missing `kind`, `baseType` or `members`) is not surfaced as a group at all by
 * {@link parseGeneratedManifestSource} — that is a corrupted file, not an under-informative one,
 * and it behaves exactly as it did before this data was carried.
 */
export type ComposedGroupRoot = {
  /** The group root's cradle key — what a legal demand names instead of a member. */
  groupKey: string;
  kind: IocGroupKind;
  baseType: string;
  /** Composed packages contributing to this root, in `composedManifests` order. */
  packageNames: readonly string[];
  members: readonly ComposedGroupMember[];
};

export type ComposedManifestSupply = {
  /** Every composed registration unit, in manifest order per package. */
  units: readonly ComposedManifestUnit[];
  /**
   * Contract default-slot aliases: access key → the registration key it resolves to.
   *
   * Mirrors `registerContractDefaultAliases` — the explicit `accessKey` when one implementation
   * carries it, otherwise the camel-cased contract name — so a demand written against the contract
   * key walks to the same unit the container will hand it.
   */
  accessKeys: ReadonlyMap<string, string>;
  /** Composed group roots: group key → member registration keys, in manifest order. */
  groupMembersByGroupKey: ReadonlyMap<string, readonly string[]>;
  /**
   * Composed group roots in FULL — kind, base type and per-member contract names.
   *
   * `groupMembersByGroupKey` answers the walk's question ("which keys does this hop resolve?");
   * this answers the demand rule's ("is this contract grouped, and what should have been written
   * instead?"). Both are projections of the same parsed roots, kept apart because a walk hop and a
   * diagnostic need different halves of the record.
   */
  groupRootsByGroupKey: ReadonlyMap<string, ComposedGroupRoot>;
  /**
   * Composed packages whose manifest carries no dependency-key data.
   *
   * Sorted. Non-empty means some part of any subtree reaching those packages is unwalkable, which
   * callers must disclose rather than paper over.
   */
  packagesWithoutDependencyData: readonly string[];
  /**
   * Composed packages whose manifest records no lifetime provenance, sorted.
   *
   * Separate from {@link packagesWithoutDependencyData} because the consequences are unrelated: a
   * package with no dependency keys makes a subtree unwalkable, while a package with no lifetime
   * provenance is walked perfectly well and merely cannot say WHY its units live as long as they
   * do. Conflating them would caveat a verdict for a reason that has nothing to do with it.
   */
  packagesWithoutLifetimeProvenance: readonly string[];
  /**
   * Composed packages whose manifest could not be resolved or read at all, sorted.
   *
   * A strict subset of {@link packagesWithoutDependencyData}, and kept apart from it because the
   * two answer different questions. That list means "some part of a subtree is unwalkable", which
   * an unreadable package and a package predating the field both cause. This one means "nothing at
   * all is known about this package" — which is what a reader has to know before concluding that a
   * name is unknown, since the name may perfectly well live in the file that could not be opened.
   *
   * Always empty unless {@link LoadComposedManifestSupplyOptions.tolerateUnreadablePackages} is set;
   * without it an unreadable package throws.
   */
  unreadablePackages: readonly string[];
};

export const EMPTY_COMPOSED_MANIFEST_SUPPLY: ComposedManifestSupply = {
  units: [],
  accessKeys: new Map(),
  groupMembersByGroupKey: new Map(),
  groupRootsByGroupKey: new Map(),
  packagesWithoutDependencyData: [],
  packagesWithoutLifetimeProvenance: [],
  unreadablePackages: [],
};

/** One package's contribution, before the per-package results are merged. */
export type ComposedManifestPackageSupply = {
  units: readonly ComposedManifestUnit[];
  accessKeys: ReadonlyMap<string, string>;
  groupMembersByGroupKey: ReadonlyMap<string, readonly string[]>;
  groupRootsByGroupKey: ReadonlyMap<string, ComposedGroupRoot>;
  /** True when the manifest declares that it carries `dependencyKeys` in full. */
  carriesDependencyKeys: boolean;
  /** True when the manifest declares that it carries `lifetimeSource` in full. */
  carriesLifetimeSource: boolean;
};

/** Member registration keys of a group node, for both group kinds (array and object). */
const groupMemberKeys = (members: IocGroupNodeManifest): string[] =>
  (Array.isArray(members)
    ? members
    : Object.values(members as Record<string, IocGroupLeafManifest>)
  ).map((leaf) => leaf.registrationKey);

/**
 * Group members with their contracts, for both group kinds.
 *
 * A record group's property KEY is carried through as `memberProperty` — it is what the
 * grouped-member guidance tells a reader to write after the group key, and it exists nowhere else.
 */
const groupMembers = (
  members: IocGroupNodeManifest,
): ComposedGroupMember[] =>
  Array.isArray(members)
    ? members.map((leaf) => ({
        contractName: leaf.contractName,
        registrationKey: leaf.registrationKey,
      }))
    : Object.entries(members as Record<string, IocGroupLeafManifest>).map(
        ([memberProperty, leaf]) => ({
          contractName: leaf.contractName,
          registrationKey: leaf.registrationKey,
          memberProperty,
        }),
      );

/** Merges one package's root into the accumulating cross-package root for the same key. */
const mergeGroupRoot = (
  existing: ComposedGroupRoot | undefined,
  incoming: ComposedGroupRoot,
): ComposedGroupRoot => {
  if (existing === undefined) {
    return incoming;
  }
  const members = [...existing.members];
  for (const member of incoming.members) {
    if (!members.some((m) => m.registrationKey === member.registrationKey)) {
      members.push(member);
    }
  }
  // `kind` and `baseType` come from the FIRST package to declare the root. Disagreement between
  // packages is a real composition error, and `checks/groups.ts` is what reports it — reporting it
  // a second time here, in a demand diagnostic, would say the same thing in the wrong place.
  return {
    ...existing,
    packageNames: [...existing.packageNames, ...incoming.packageNames],
    members,
  };
};

/**
 * Projects one generated manifest source into walk-ready supply.
 *
 * The parse itself is {@link parseGeneratedManifestSource}, shared with `ioc inspect` — this is the
 * projection onto the question a demand walk asks. Keeping the two on one parser is the point: a
 * field the generator starts emitting reaches both readers at once, and neither can quietly fall
 * behind the other's idea of what a manifest says.
 *
 * Exported for its own tests and because it is the whole of the supply logic; the loader below only
 * resolves paths and merges.
 */
export const parseComposedManifestSupplySource = (
  content: string,
  manifestPath: string,
  packageName: string,
): ComposedManifestPackageSupply => {
  const parsed = parseGeneratedManifestSource(content, manifestPath);

  const units: ComposedManifestUnit[] = [];
  const accessKeys = new Map<string, string>();
  const groupMembersByGroupKey = new Map<string, readonly string[]>();
  const groupRootsByGroupKey = new Map<string, ComposedGroupRoot>();

  for (const [contractName, impls] of Object.entries(parsed.contracts)) {
    const contractUnits: ComposedManifestUnit[] = [];

    for (const meta of Object.values(impls)) {
      contractUnits.push({
        packageName,
        contractName,
        implementationName: meta.implementationName,
        registrationKey: meta.registrationKey,
        exportName: meta.exportName,
        // Package-qualified — see the note on `ComposedManifestUnit.modulePath`.
        modulePath: `${packageName}/${meta.modulePath}`,
        lifetime: meta.lifetime,
        isDefault: meta.default === true,
        ...(meta.dependencyKeys !== undefined
          ? { dependencyKeys: meta.dependencyKeys }
          : {}),
        ...(meta.lifetimeSource !== undefined
          ? { lifetimeSource: meta.lifetimeSource }
          : {}),
      });
    }

    units.push(...contractUnits);

    // The default-slot alias, through the SAME derivation `registerContractDefaultAliases` and the
    // registration plan go through — and only when some implementation is actually marked default,
    // because no election means no slot key anywhere.
    const defaultUnit = contractUnits.find((unit) => unit.isDefault);
    if (defaultUnit !== undefined) {
      accessKeys.set(
        resolveManifestAccessKey(contractName, Object.values(impls)),
        defaultUnit.registrationKey,
      );
    }
  }

  for (const [groupKey, root] of Object.entries(
    parsed.groupRoots as Record<string, IocGroupRootManifest>,
  )) {
    groupMembersByGroupKey.set(groupKey, groupMemberKeys(root.members));
    groupRootsByGroupKey.set(groupKey, {
      groupKey,
      kind: root.kind,
      baseType: root.baseType,
      packageNames: [packageName],
      members: groupMembers(root.members),
    });
  }

  return {
    units,
    accessKeys,
    groupMembersByGroupKey,
    groupRootsByGroupKey,
    carriesDependencyKeys: (parsed.declaredFeatures ?? []).includes(
      "dependencyKeys",
    ),
    carriesLifetimeSource: (parsed.declaredFeatures ?? []).includes(
      "lifetimeSource",
    ),
  };
};

/**
 * The composed contract-name universe, projected off supply this run has already parsed.
 *
 * `loadComposedManifestContractNames` answers the same question by opening the same files a second
 * time, which is the right shape for generation (it needs the names before it needs anything else)
 * and the wrong one for a caller that is about to read the whole supply anyway. Same manifests,
 * same parser, one pass — the widening pattern the composed group-membership index already
 * follows: reuse what was read, never re-read it.
 */
export const composedContractNamesFromSupply = (
  supply: ComposedManifestSupply,
): ComposedManifestContractNames => {
  const byPackage = new Map<string, Set<string>>();
  const all = new Set<string>();
  for (const unit of supply.units) {
    let names = byPackage.get(unit.packageName);
    if (names === undefined) {
      names = new Set<string>();
      byPackage.set(unit.packageName, names);
    }
    names.add(unit.contractName);
    all.add(unit.contractName);
  }
  return { all, byPackage };
};

export type LoadComposedManifestSupplyOptions = {
  readonly customConditions?: readonly string[];
  /**
   * Swallow per-package resolution/read failures instead of throwing.
   *
   * For inspection, which is a VIEW: a package that cannot be resolved must show up as a thinner
   * report, never as a crashed `ioc inspect`. Generation leaves it off — there, an unreadable
   * composed manifest is a real failure and every other composed loader already treats it as one.
   */
  readonly tolerateUnreadablePackages?: boolean;
};

/**
 * Composed supply for every package in `composedPackageNames`, merged.
 *
 * Later packages do not overwrite earlier ones for group members — composition MERGES group roots
 * across manifests, so members accumulate, which is what `composeManifests` does at runtime.
 */
export const loadComposedManifestSupply = async (
  projectRoot: string,
  composedPackageNames: readonly string[],
  options?: LoadComposedManifestSupplyOptions,
): Promise<ComposedManifestSupply> => {
  const units: ComposedManifestUnit[] = [];
  const accessKeys = new Map<string, string>();
  const groupMemberKeysByGroup = new Map<string, string[]>();
  const groupRoots = new Map<string, ComposedGroupRoot>();
  const packagesWithoutDependencyData: string[] = [];
  const packagesWithoutLifetimeProvenance: string[] = [];
  const unreadablePackages: string[] = [];

  for (const packageName of composedPackageNames) {
    let parsed: ComposedManifestPackageSupply;
    try {
      const manifestPath = resolvePackageExportPath(
        projectRoot,
        packageName,
        "./iocManifest",
        { customConditions: options?.customConditions },
      );
      parsed = parseComposedManifestSupplySource(
        fs.readFileSync(manifestPath, "utf8"),
        manifestPath,
        packageName,
      );
    } catch (error) {
      if (options?.tolerateUnreadablePackages === true) {
        // Unreadable is not "carries no dependency data" — but from a walk's point of view the
        // consequence is identical, and saying so is strictly better than saying nothing.
        packagesWithoutDependencyData.push(packageName);
        packagesWithoutLifetimeProvenance.push(packageName);
        unreadablePackages.push(packageName);
        continue;
      }
      throw error;
    }

    units.push(...parsed.units);
    for (const [accessKey, registrationKey] of parsed.accessKeys) {
      if (!accessKeys.has(accessKey)) {
        accessKeys.set(accessKey, registrationKey);
      }
    }
    for (const [groupKey, members] of parsed.groupMembersByGroupKey) {
      const existing = groupMemberKeysByGroup.get(groupKey);
      if (existing === undefined) {
        groupMemberKeysByGroup.set(groupKey, [...members]);
        continue;
      }
      for (const member of members) {
        if (!existing.includes(member)) {
          existing.push(member);
        }
      }
    }
    for (const [groupKey, root] of parsed.groupRootsByGroupKey) {
      groupRoots.set(groupKey, mergeGroupRoot(groupRoots.get(groupKey), root));
    }
    if (!parsed.carriesDependencyKeys) {
      packagesWithoutDependencyData.push(packageName);
    }
    if (!parsed.carriesLifetimeSource) {
      packagesWithoutLifetimeProvenance.push(packageName);
    }
  }

  return {
    units,
    accessKeys,
    groupMembersByGroupKey: new Map(groupMemberKeysByGroup),
    groupRootsByGroupKey: new Map(groupRoots),
    packagesWithoutDependencyData: [...packagesWithoutDependencyData].sort(
      (a, b) => a.localeCompare(b),
    ),
    packagesWithoutLifetimeProvenance: [
      ...packagesWithoutLifetimeProvenance,
    ].sort((a, b) => a.localeCompare(b)),
    unreadablePackages: [...unreadablePackages].sort((a, b) =>
      a.localeCompare(b),
    ),
  };
};
