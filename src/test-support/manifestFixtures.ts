/**
 * @fileoverview Shared manifest builders for unit tests (compose, validate, runtime).
 */
import type {
  IocContractManifest,
  IocModuleNamespace,
  IocRegisterableManifest,
} from "../core/manifest.js";
import { MANIFEST_SCHEMA_VERSION } from "../schemaVersion.js";
import type { ComposedRegistrationOverrides } from "../runtime/composedOverrides.js";
import type { ParsedManifestSlice, ValidateContext } from "../validate/types.js";

export const implMeta = (
  partial: {
    contractName: string;
    implementationName: string;
    exportName?: string;
    registrationKey?: string;
    moduleIndex?: number;
    default?: boolean;
  },
): IocContractManifest[string][string] => ({
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

export const validateContext = (
  slices: readonly ParsedManifestSlice[],
  overrides?: ComposedRegistrationOverrides,
): ValidateContext => ({
  projectRoot: "/proj",
  configPath: "/proj/ioc.config.ts",
  slices,
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
