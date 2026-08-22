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
  IocGroupLeafManifest,
  IocGroupNodeManifest,
  IocImplementationLifetime,
} from "../core/manifest.js";
import { resolveManifestAccessKey } from "../core/contractAccessKey.js";
import { parseGeneratedManifestSource } from "./parseGeneratedManifestSource.js";
import { resolvePackageExportPath } from "./resolveComposedPackageExport.js";

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
   * Composed packages whose manifest carries no dependency-key data.
   *
   * Sorted. Non-empty means some part of any subtree reaching those packages is unwalkable, which
   * callers must disclose rather than paper over.
   */
  packagesWithoutDependencyData: readonly string[];
};

export const EMPTY_COMPOSED_MANIFEST_SUPPLY: ComposedManifestSupply = {
  units: [],
  accessKeys: new Map(),
  groupMembersByGroupKey: new Map(),
  packagesWithoutDependencyData: [],
};

/** One package's contribution, before the per-package results are merged. */
export type ComposedManifestPackageSupply = {
  units: readonly ComposedManifestUnit[];
  accessKeys: ReadonlyMap<string, string>;
  groupMembersByGroupKey: ReadonlyMap<string, readonly string[]>;
  /** True when the manifest declares that it carries `dependencyKeys` in full. */
  carriesDependencyKeys: boolean;
};

/** Member registration keys of a group node, for both group kinds (array and object). */
const groupMemberKeys = (members: IocGroupNodeManifest): string[] =>
  (Array.isArray(members)
    ? members
    : Object.values(members as Record<string, IocGroupLeafManifest>)
  ).map((leaf) => leaf.registrationKey);

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

  for (const [groupKey, root] of Object.entries(parsed.groupRoots)) {
    groupMembersByGroupKey.set(groupKey, groupMemberKeys(root.members));
  }

  return {
    units,
    accessKeys,
    groupMembersByGroupKey,
    carriesDependencyKeys: (parsed.declaredFeatures ?? []).includes(
      "dependencyKeys",
    ),
  };
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
  const groupMembers = new Map<string, string[]>();
  const packagesWithoutDependencyData: string[] = [];

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
      const existing = groupMembers.get(groupKey);
      if (existing === undefined) {
        groupMembers.set(groupKey, [...members]);
        continue;
      }
      for (const member of members) {
        if (!existing.includes(member)) {
          existing.push(member);
        }
      }
    }
    if (!parsed.carriesDependencyKeys) {
      packagesWithoutDependencyData.push(packageName);
    }
  }

  return {
    units,
    accessKeys,
    groupMembersByGroupKey: new Map(groupMembers),
    packagesWithoutDependencyData: [...packagesWithoutDependencyData].sort(
      (a, b) => a.localeCompare(b),
    ),
  };
};
