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
  type IocGroupNodeManifest,
  type IocModuleNamespace,
  type IocRegisterableManifest,
  type ModuleFactoryManifestMetadata,
} from "../core/manifest.js";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";

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

export const formatConflictingGroupRootKeyError = (
  key: string,
  indexA: number,
  indexB: number,
): string =>
  [
    `[ioc] Conflicting group root key ${JSON.stringify(key)} across manifests:`,
    `  - Declared by manifest at index ${indexA}`,
    `  - Declared by manifest at index ${indexB}`,
    "Cross-manifest group composition is not yet supported; this will land in a future release.",
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

/**
 * Merges deduplicated manifests (caller should validate schema versions first).
 * Returns a single manifest with `manifestSchemaVersion: 1`.
 */
export const composeManifests = (
  manifests: readonly IocRegisterableManifest[],
): IocRegisterableManifest => {
  const indexed = indexManifestsPreservingOriginalIndices(manifests);
  const sorted = sortIndexedManifestsForIteration(indexed);

  const mergedImports: IocModuleNamespace[] = [];
  const mergedContracts: IocContractManifest = {};
  const mergedGroupRoots: Record<string, IocGroupNodeManifest> = {};
  const keyOwners = new Map<string, KeyOwner>();

  for (const { manifest, originalIndex } of sorted) {
    let moduleOffset = mergedImports.length;

    for (const [contractName, impls] of Object.entries(manifest.contracts)) {
      for (const [implementationName, meta] of Object.entries(impls)) {
        const key = meta.registrationKey;
        const existing = keyOwners.get(key);
        if (existing !== undefined) {
          if (existing.kind === "groupRoot") {
            throw new Error(
              formatConflictingGroupRootKeyError(
                key,
                existing.originalIndex,
                originalIndex,
              ),
            );
          }
          throw new Error(
            formatConflictingRegistrationKeyError(key, existing, {
              kind: "implementation",
              originalIndex,
              contractName,
              implementationName,
            }),
          );
        }
        keyOwners.set(key, {
          kind: "implementation",
          originalIndex,
          contractName,
          implementationName,
        });

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
      const existing = keyOwners.get(groupKey);
      if (existing !== undefined) {
        if (existing.kind === "groupRoot") {
          throw new Error(
            formatConflictingGroupRootKeyError(
              groupKey,
              existing.originalIndex,
              originalIndex,
            ),
          );
        }
        throw new Error(
          formatConflictingRegistrationKeyError(groupKey, existing, {
            kind: "implementation",
            originalIndex,
            contractName: "(group root)",
            implementationName: "(group root)",
          }),
        );
      }
      keyOwners.set(groupKey, { kind: "groupRoot", originalIndex });
      mergedGroupRoots[groupKey] = manifest[groupKey] as IocGroupNodeManifest;
    }

    mergedImports.push(...manifest.moduleImports);
  }

  applyCrossManifestDefaultPolicy(mergedContracts, sorted);

  return {
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    moduleImports: mergedImports,
    contracts: mergedContracts,
    ...mergedGroupRoots,
  };
};

export const prepareManifestsForRegistration = (
  manifests: readonly IocRegisterableManifest[],
): IocRegisterableManifest => {
  const indexed = indexManifestsPreservingOriginalIndices(manifests);
  validateManifestSchemaVersions(indexed);
  return composeManifests(manifests);
};
