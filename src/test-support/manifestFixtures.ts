/**
 * @fileoverview Shared manifest builders for unit tests (compose, validate, runtime).
 */
import type {
  IocContractManifest,
  IocModuleNamespace,
  IocRegisterableManifest,
  IocUnitKind,
} from "../core/manifest.js";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";
import type { ComposedRegistrationOverrides } from "../runtime/composedOverrides.js";
import type { ParsedManifestSlice, CompositionContext } from "../composition/types.js";

export const implMeta = (
  partial: {
    contractName: string;
    implementationName: string;
    exportName?: string;
    registrationKey?: string;
    moduleIndex?: number;
    default?: boolean;
    kind?: IocUnitKind;
  },
): IocContractManifest[string][string] => ({
  ...(partial.kind !== undefined ? { kind: partial.kind } : {}),
  exportName:
    partial.exportName ??
    `build${partial.implementationName.charAt(0).toUpperCase()}${partial.implementationName.slice(1)}`,
  registrationKey: partial.registrationKey ?? partial.implementationName,
  modulePath: `${partial.implementationName}.ts`,
  relImport: `../${partial.implementationName}.js`,
  contractName: partial.contractName,
  implementationName: partial.implementationName,
  lifetime: "singleton",
  moduleIndex: partial.moduleIndex ?? 0,
  ...(partial.default === true ? { default: true as const } : {}),
});

export const baseManifest = (
  contracts: IocContractManifest,
  moduleImports: readonly IocModuleNamespace[] = [],
  extras: Record<string, unknown> = {},
): IocRegisterableManifest => ({
  manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
  moduleImports,
  contracts,
  ...extras,
});

/**
 * One implementation entry as a generated manifest actually writes it.
 *
 * `registrationKey`, `exportName` and `modulePath` together are a unit's IDENTITY, and the manifest
 * parser drops an entry missing any of them — an implementation nobody can say anything true about.
 * Fixtures that stated only a registration key were describing a manifest the generator never emits,
 * so they get the full triple here rather than a parser lenient enough to accept them.
 */
export const implSource = (
  registrationKey: string,
  extra = "",
): string =>
  `{ registrationKey: ${JSON.stringify(registrationKey)}, exportName: ${JSON.stringify(
    `build${registrationKey.charAt(0).toUpperCase()}${registrationKey.slice(1)}`,
  )}, modulePath: ${JSON.stringify(`${registrationKey}.ts`)}${extra} }`;

export const manifestSource = (
  contracts: string,
  extras = "",
  version: number = MANIFEST_SCHEMA_VERSION,
): string => `export const iocManifest = {
  manifestSchemaVersion: ${version},
  moduleImports: [],
  contracts: { ${contracts} },
  ${extras}
};`;

export const typesSource = (
  cradle: string,
  externals: string,
): string => `export interface IocGeneratedCradle { ${cradle} }
export interface IocExternals { ${externals} }`;

export const parsedSlice = (
  partial: Partial<ParsedManifestSlice> & Pick<ParsedManifestSlice, "packageLabel">,
): ParsedManifestSlice => ({
  sourceId: partial.sourceId ?? partial.packageLabel,
  manifestPath: partial.manifestPath ?? "/tmp/ioc-manifest.ts",
  typesPath: partial.typesPath ?? "/tmp/ioc-registry.types.ts",
  manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
  contracts: {},
  groupRoots: {},
  cradleKeys: new Set(),
  cradleTypes: {},
  externals: {},
  ...partial,
});

export const compositionContextFixture = (
  slices: readonly ParsedManifestSlice[],
  overrides?: ComposedRegistrationOverrides,
): CompositionContext => ({
  projectRoot: "/proj",
  configPath: "/proj/ioc.config.ts",
  slices,
  // No app source and no pending output: a unit-test context roots the program on the slices'
  // types files alone. Production always goes through `loadCompositionContext`, which supplies the
  // app's real source set.
  sourceFiles: [],
  pendingArtifacts: undefined,
  tsconfig: undefined,
  composedPackageNames: slices.slice(1).map((s) => s.sourceId),
  overrides,
  localContractNames: new Set(Object.keys(slices[0]?.contracts ?? {})),
  composedContractNames: new Set(
    slices.slice(1).flatMap((s) => Object.keys(s.contracts)),
  ),
  declaredGroupNames: new Set(
    slices.flatMap((s) => Object.keys(s.groupRoots)),
  ),
});
