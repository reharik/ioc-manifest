/**
 * @fileoverview Merges multiple generated container manifests into one registerable manifest.
 *
 * Composition semantics are set-like: input order does not affect registrations or default
 * resolution. Manifests are deduplicated by reference identity, then processed in a stable
 * internal order (fingerprint sort) so error messages are deterministic for `[a,b]` vs `[b,a]`.
 * Error messages always cite the manifest's original index in the array the caller passed.
 */
import {
  IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS,
  type IocContractManifest,
  type IocGroupCollectionManifest,
  type IocGroupLeafManifest,
  type IocGroupNodeManifest,
  type IocGroupObjectManifest,
  type IocGroupRootManifest,
  type IocModuleNamespace,
  type IocRegisterableManifest,
  type ModuleFactoryManifestMetadata,
} from "../core/manifest.js";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";
import type { ComposedRegistrationOverrides } from "./composedOverrides.js";
import { areCanonicalBaseTypeIdsEquivalent } from "./groupBaseTypeEquivalence.js";

type IndexedManifest = {
  readonly manifest: IocRegisterableManifest;
  /** Position in the array originally passed to `registerIocFromManifest`. */
  readonly originalIndex: number;
};

type KeyOwner =
  | {
      readonly kind: "implementation";
      readonly originalIndex: number;
      readonly contractName: string;
      readonly implementationName: string;
    }
  | {
      readonly kind: "groupRoot";
      readonly originalIndex: number;
    };

const extractGroupRootKeys = (manifest: IocRegisterableManifest): string[] => {
  const keys: string[] = [];
  for (const key of Object.keys(manifest)) {
    if (IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS.has(key)) {
      continue;
    }
    keys.push(key);
  }
  return keys;
};

const manifestFingerprint = (manifest: IocRegisterableManifest): string => {
  const keys: string[] = [];
  for (const impls of Object.values(manifest.contracts)) {
    for (const meta of Object.values(impls)) {
      keys.push(meta.registrationKey);
    }
  }
  keys.push(...extractGroupRootKeys(manifest));
  return keys.sort((a, b) => a.localeCompare(b)).join("\0");
};

const indexManifestsPreservingOriginalIndices = (
  manifests: readonly IocRegisterableManifest[],
): readonly IndexedManifest[] => {
  const seen = new Set<IocRegisterableManifest>();
  const indexed: IndexedManifest[] = [];

  for (let i = 0; i < manifests.length; i++) {
    const manifest = manifests[i]!;
    if (seen.has(manifest)) {
      continue;
    }
    seen.add(manifest);
    indexed.push({ manifest, originalIndex: i });
  }

  return indexed;
};

const sortIndexedManifestsForIteration = (
  indexed: readonly IndexedManifest[],
): readonly IndexedManifest[] =>
  [...indexed].sort((a, b) => {
    const fa = manifestFingerprint(a.manifest);
    const fb = manifestFingerprint(b.manifest);
    const cmp = fa.localeCompare(fb);
    if (cmp !== 0) {
      return cmp;
    }
    return a.originalIndex - b.originalIndex;
  });

export const formatManifestSchemaVersionMismatchError = (
  mismatches: readonly { readonly version: unknown; readonly originalIndex: number }[],
): string => {
  const lines = [
    "[ioc] Manifest schema version mismatch.",
    `  Runtime expects: ${MANIFEST_SCHEMA_VERSION}`,
  ];
  for (const { version, originalIndex } of mismatches) {
    lines.push(
      `  Got: ${String(version)} from manifest at index ${originalIndex}`,
    );
  }
  lines.push(
    "This usually means a composed package was built against an incompatible version of ioc-manifest.",
  );
  return lines.join("\n");
};

export const validateManifestSchemaVersions = (
  indexed: readonly IndexedManifest[],
): void => {
  const mismatches: { version: unknown; originalIndex: number }[] = [];
  for (const { manifest, originalIndex } of indexed) {
    if (manifest.manifestSchemaVersion !== MANIFEST_SCHEMA_VERSION) {
      mismatches.push({
        version: manifest.manifestSchemaVersion,
        originalIndex,
      });
    }
  }
  if (mismatches.length > 0) {
    throw new Error(formatManifestSchemaVersionMismatchError(mismatches));
  }
};

export const formatConflictingRegistrationKeyError = (
  key: string,
  a: KeyOwner & { kind: "implementation" },
  b: KeyOwner & { kind: "implementation" },
): string =>
  [
    `[ioc] Conflicting registration key ${JSON.stringify(key)} across manifests:`,
    `  - Supplied by manifest at index ${a.originalIndex} (contract: ${a.contractName}, implementation: ${a.implementationName})`,
    `  - Supplied by manifest at index ${b.originalIndex} (contract: ${b.contractName}, implementation: ${b.implementationName})`,
    `Resolve by configuring "registrations.${a.contractName}.${a.implementationName}.source" in your app's ioc.config.`,
  ].join("\n");

export const formatGroupKindMismatchError = (
  groupName: string,
  indexA: number,
  kindA: string,
  indexB: number,
  kindB: string,
): string =>
  [
    `[ioc] Group ${JSON.stringify(groupName)} declared with mismatched kinds across manifests:`,
    `  - Manifest at index ${indexA}: kind ${JSON.stringify(kindA)}`,
    `  - Manifest at index ${indexB}: kind ${JSON.stringify(kindB)}`,
  ].join("\n");

export const formatGroupBaseTypeMismatchError = (
  groupName: string,
  indexA: number,
  baseTypeA: string,
  idA: string,
  indexB: number,
  baseTypeB: string,
  idB: string,
): string =>
  [
    `[ioc] Group ${JSON.stringify(groupName)} declared with mismatched base types across manifests:`,
    `  - Manifest at index ${indexA}: baseType ${JSON.stringify(baseTypeA)} (id: ${JSON.stringify(idA)})`,
    `  - Manifest at index ${indexB}: baseType ${JSON.stringify(baseTypeB)} (id: ${JSON.stringify(idB)})`,
    "If these refer to the same logical type (e.g. due to hoisting issues), add the following to your ioc.config.ts:",
    "  groupBaseTypeAliases: {",
    `    ${JSON.stringify(groupName)}: [${JSON.stringify(idA)}, ${JSON.stringify(idB)}],`,
    "  }",
  ].join("\n");

export const formatObjectGroupKeyCollisionError = (
  groupName: string,
  objectKey: string,
  indexA: number,
  indexB: number,
): string =>
  [
    `[ioc] Object group ${JSON.stringify(groupName)} has duplicate key ${JSON.stringify(objectKey)} across manifests:`,
    `  - Manifest at index ${indexA}`,
    `  - Manifest at index ${indexB}`,
    `Resolve by configuring registrations.<Contract>.<implementation>.source in your app's ioc.config.`,
  ].join("\n");

export const formatConflictingDefaultDeclarationError = (
  contractName: string,
  a: { readonly originalIndex: number; readonly implementationName: string },
  b: { readonly originalIndex: number; readonly implementationName: string },
): string =>
  [
    `[ioc] Conflicting default declaration for contract ${JSON.stringify(contractName)} across manifests:`,
    `  - Manifest at index ${a.originalIndex} (implementation: ${a.implementationName})`,
    `  - Manifest at index ${b.originalIndex} (implementation: ${b.implementationName})`,
    "Mark exactly one default in your app's ioc.config registrations, or ensure only one composed manifest declares a default for this contract.",
  ].join("\n");

const findDefaultDeclarationInManifest = (
  manifest: IocRegisterableManifest,
  contractName: string,
): ModuleFactoryManifestMetadata | undefined => {
  const impls = manifest.contracts[contractName];
  if (impls === undefined) {
    return undefined;
  }
  return Object.values(impls).find((meta) => meta.default === true);
};

const applyCrossManifestDefaultPolicy = (
  mergedContracts: IocContractManifest,
  contributingManifests: readonly IndexedManifest[],
  overrides: ComposedRegistrationOverrides | undefined,
): void => {
  const contractNames = new Set<string>();
  for (const { manifest } of contributingManifests) {
    for (const name of Object.keys(manifest.contracts)) {
      contractNames.add(name);
    }
  }

  for (const contractName of [...contractNames].sort((a, b) =>
    a.localeCompare(b),
  )) {
    if (
      overrides?.contracts?.[contractName]?.defaultImplementation !== undefined
    ) {
      continue;
    }

    const declaring: {
      originalIndex: number;
      implementationName: string;
    }[] = [];

    for (const { manifest, originalIndex } of contributingManifests) {
      const defaultMeta = findDefaultDeclarationInManifest(
        manifest,
        contractName,
      );
      if (defaultMeta !== undefined) {
        declaring.push({
          originalIndex,
          implementationName: defaultMeta.implementationName,
        });
      }
    }

    if (declaring.length > 1) {
      throw new Error(
        formatConflictingDefaultDeclarationError(
          contractName,
          declaring[0]!,
          declaring[1]!,
        ),
      );
    }

    if (declaring.length === 0) {
      continue;
    }

    const winningImplementationName = declaring[0]!.implementationName;
    const impls = mergedContracts[contractName];
    if (impls === undefined) {
      continue;
    }

    for (const [implName, meta] of Object.entries(impls)) {
      if (meta.default === true && implName !== winningImplementationName) {
        const { default: _removed, ...rest } = meta;
        impls[implName] = rest;
      }
    }
  }
};

const cloneMetaWithModuleIndex = (
  meta: ModuleFactoryManifestMetadata,
  moduleIndex: number,
): ModuleFactoryManifestMetadata => ({
  ...meta,
  moduleIndex,
});

const orderOwnersByOriginalIndex = <T extends { readonly originalIndex: number }>(
  a: T,
  b: T,
): readonly [T, T] =>
  a.originalIndex <= b.originalIndex ? [a, b] : [b, a];

const throwRegistrationKeyConflict = (
  key: string,
  first: KeyOwner & { kind: "implementation" },
  second: KeyOwner & { kind: "implementation" },
): never => {
  const [a, b] = orderOwnersByOriginalIndex(first, second);
  throw new Error(formatConflictingRegistrationKeyError(key, a, b));
};

const buildManifestIndexForSource = (
  overrides: ComposedRegistrationOverrides | undefined,
): ((source: string) => number) | undefined => {
  const packages = overrides?.composedPackageNames;
  if (packages === undefined) {
    return undefined;
  }
  const indexByPackage = new Map<string, number>();
  packages.forEach((pkg, i) => {
    indexByPackage.set(pkg, i + 1);
  });
  return (source: string): number => {
    if (source === "local") {
      return 0;
    }
    const idx = indexByPackage.get(source);
    if (idx === undefined) {
      throw new Error(
        `[ioc] internal error: source override references unknown package ${JSON.stringify(source)}`,
      );
    }
    return idx;
  };
};

const resolveSourceOverrideWinnerIndex = (
  existing: KeyOwner & { kind: "implementation" },
  incoming: KeyOwner & { kind: "implementation" },
  overrides: ComposedRegistrationOverrides | undefined,
  indexForSource: ((source: string) => number) | undefined,
): number | undefined => {
  if (indexForSource === undefined || overrides?.contracts === undefined) {
    return undefined;
  }

  const resolveForOwner = (
    owner: KeyOwner & { kind: "implementation" },
  ): number | undefined => {
    const source =
      overrides.contracts?.[owner.contractName]?.sourceOverride?.[
        owner.implementationName
      ];
    if (source === undefined) {
      return undefined;
    }
    return indexForSource(source);
  };

  const fromExisting = resolveForOwner(existing);
  const fromIncoming = resolveForOwner(incoming);

  if (fromExisting !== undefined && fromIncoming !== undefined) {
    if (fromExisting !== fromIncoming) {
      throw new Error(
        `[ioc] Conflicting source overrides for the same registration key across ${JSON.stringify(existing.contractName)}.${existing.implementationName} and ${JSON.stringify(incoming.contractName)}.${incoming.implementationName}.`,
      );
    }
    return fromExisting;
  }

  return fromExisting ?? fromIncoming;
};

const removeImplementationFromMerged = (
  mergedContracts: IocContractManifest,
  owner: KeyOwner & { kind: "implementation" },
): void => {
  const bucket = mergedContracts[owner.contractName];
  if (bucket === undefined) {
    return;
  }
  delete bucket[owner.implementationName];
  if (Object.keys(bucket).length === 0) {
    delete mergedContracts[owner.contractName];
  }
};

const applyAppDefaultOverrides = (
  mergedContracts: IocContractManifest,
  overrides: ComposedRegistrationOverrides | undefined,
): void => {
  if (overrides?.contracts === undefined) {
    return;
  }

  for (const [contractName, spec] of Object.entries(overrides.contracts)) {
    const winningName = spec.defaultImplementation;
    if (winningName === undefined) {
      continue;
    }

    const impls = mergedContracts[contractName];
    if (impls === undefined) {
      continue;
    }

    for (const [implName, meta] of Object.entries(impls)) {
      if (implName === winningName) {
        impls[implName] = { ...meta, default: true };
      } else if (meta.default === true) {
        const { default: _removed, ...rest } = meta;
        impls[implName] = rest;
      }
    }
  }
};

const asGroupRootManifest = (value: unknown): IocGroupRootManifest => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("kind" in value) ||
    !("baseType" in value) ||
    !("baseTypeId" in value) ||
    !("members" in value)
  ) {
    throw new Error(
      "[ioc] internal error: expected schema v2 group root (kind, baseType, baseTypeId, members)",
    );
  }
  return value as IocGroupRootManifest;
};

const mergeCollectionMembers = (
  a: IocGroupCollectionManifest,
  b: IocGroupCollectionManifest,
): IocGroupCollectionManifest => {
  const byKey = new Map<string, IocGroupLeafManifest>();
  for (const leaf of [...a, ...b]) {
    byKey.set(leaf.registrationKey, leaf);
  }
  return [...byKey.values()].sort((x, y) =>
    x.registrationKey.localeCompare(y.registrationKey),
  );
};

const mergeObjectGroupMembers = (
  groupName: string,
  a: IocGroupObjectManifest,
  b: IocGroupObjectManifest,
  indexA: number,
  indexB: number,
): IocGroupObjectManifest => {
  const merged: IocGroupObjectManifest = { ...a };
  for (const [key, leaf] of Object.entries(b)) {
    if (merged[key] !== undefined) {
      throw new Error(
        formatObjectGroupKeyCollisionError(groupName, key, indexA, indexB),
      );
    }
    merged[key] = leaf;
  }
  return merged;
};

const mergeGroupRootManifests = (
  groupName: string,
  existing: IocGroupRootManifest,
  incoming: IocGroupRootManifest,
  indexA: number,
  indexB: number,
  aliasSets: Readonly<Record<string, readonly string[]>> | undefined,
): IocGroupRootManifest => {
  if (existing.kind !== incoming.kind) {
    throw new Error(
      formatGroupKindMismatchError(
        groupName,
        indexA,
        existing.kind,
        indexB,
        incoming.kind,
      ),
    );
  }

  if (
    !areCanonicalBaseTypeIdsEquivalent(
      existing.baseTypeId,
      incoming.baseTypeId,
      groupName,
      aliasSets,
    )
  ) {
    throw new Error(
      formatGroupBaseTypeMismatchError(
        groupName,
        indexA,
        existing.baseType,
        existing.baseTypeId,
        indexB,
        incoming.baseType,
        incoming.baseTypeId,
      ),
    );
  }

  if (existing.kind === "collection") {
    return {
      kind: "collection",
      baseType: existing.baseType,
      baseTypeId: existing.baseTypeId,
      members: mergeCollectionMembers(
        existing.members as IocGroupCollectionManifest,
        incoming.members as IocGroupCollectionManifest,
      ),
    };
  }

  return {
    kind: "object",
    baseType: existing.baseType,
    baseTypeId: existing.baseTypeId,
    members: mergeObjectGroupMembers(
      groupName,
      existing.members as IocGroupObjectManifest,
      incoming.members as IocGroupObjectManifest,
      indexA,
      indexB,
    ),
  };
};

/**
 * Merges deduplicated manifests (caller should validate schema versions first).
 * Returns a single manifest with the current `manifestSchemaVersion`.
 */
export const composeManifests = (
  manifests: readonly IocRegisterableManifest[],
  overrides?: ComposedRegistrationOverrides,
): IocRegisterableManifest => {
  const indexed = indexManifestsPreservingOriginalIndices(manifests);
  const sorted = sortIndexedManifestsForIteration(indexed);
  const indexForSource = buildManifestIndexForSource(overrides);

  const mergedImports: IocModuleNamespace[] = [];
  const mergedContracts: IocContractManifest = {};
  const mergedGroupRoots: Record<string, IocGroupRootManifest> = {};
  const groupRootContributorIndex = new Map<string, number>();
  const aliasSets = overrides?.groups?.baseTypeAliases;
  const keyOwners = new Map<string, KeyOwner>();

  for (const { manifest, originalIndex } of sorted) {
    let moduleOffset = mergedImports.length;

    for (const [contractName, impls] of Object.entries(manifest.contracts)) {
      for (const [implementationName, meta] of Object.entries(impls)) {
        const key = meta.registrationKey;
        const existing = keyOwners.get(key);
        if (existing !== undefined) {
          if (existing.kind === "groupRoot") {
            throwGroupRootKeyConflict(key, existing, {
              kind: "groupRoot",
              originalIndex,
            });
          } else {
            const incomingOwner: KeyOwner & { kind: "implementation" } = {
              kind: "implementation",
              originalIndex,
              contractName,
              implementationName,
            };
            const winnerIndex = resolveSourceOverrideWinnerIndex(
              existing,
              incomingOwner,
              overrides,
              indexForSource,
            );
            if (winnerIndex === undefined) {
              throwRegistrationKeyConflict(key, existing, incomingOwner);
            }
            if (originalIndex !== winnerIndex) {
              continue;
            }
            removeImplementationFromMerged(mergedContracts, existing);
            keyOwners.set(key, incomingOwner);
          }
        } else {
          keyOwners.set(key, {
            kind: "implementation",
            originalIndex,
            contractName,
            implementationName,
          });
        }

        let contractBucket = mergedContracts[contractName];
        if (contractBucket === undefined) {
          contractBucket = {};
          mergedContracts[contractName] = contractBucket;
        }
        contractBucket[implementationName] = cloneMetaWithModuleIndex(
          meta,
          meta.moduleIndex + moduleOffset,
        );
      }
    }

    for (const groupKey of extractGroupRootKeys(manifest).sort((a, b) =>
      a.localeCompare(b),
    )) {
      const incomingRoot = asGroupRootManifest(manifest[groupKey]);
      const existingOwner = keyOwners.get(groupKey);
      if (existingOwner !== undefined) {
        if (existingOwner.kind === "groupRoot") {
          const firstIndex = groupRootContributorIndex.get(groupKey)!;
          mergedGroupRoots[groupKey] = mergeGroupRootManifests(
            groupKey,
            mergedGroupRoots[groupKey]!,
            incomingRoot,
            firstIndex,
            originalIndex,
            aliasSets,
          );
        } else {
          throwRegistrationKeyConflict(groupKey, existingOwner, {
            kind: "implementation",
            originalIndex,
            contractName: "(group root)",
            implementationName: "(group root)",
          });
        }
      } else {
        keyOwners.set(groupKey, { kind: "groupRoot", originalIndex });
        groupRootContributorIndex.set(groupKey, originalIndex);
        mergedGroupRoots[groupKey] = incomingRoot;
      }
    }

    mergedImports.push(...manifest.moduleImports);
  }

  applyAppDefaultOverrides(mergedContracts, overrides);
  applyCrossManifestDefaultPolicy(mergedContracts, sorted, overrides);

  return {
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    moduleImports: mergedImports,
    contracts: mergedContracts,
    ...mergedGroupRoots,
  };
};

export const prepareManifestsForRegistration = (
  manifests: readonly IocRegisterableManifest[],
  overrides?: ComposedRegistrationOverrides,
): IocRegisterableManifest => {
  const indexed = indexManifestsPreservingOriginalIndices(manifests);
  validateManifestSchemaVersions(indexed);
  return composeManifests(manifests, overrides);
};
