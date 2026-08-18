/**
 * Public API for **ioc-manifest**: contract-first factory discovery, generated Awilix manifests,
 * and runtime registration.
 *
 * Typical flow: define IoC config (`defineIocConfig` / `ioc.config.ts`), run
 * `generateManifest()` (or the `ioc generate` CLI), import the emitted manifest module,
 * then call `registerIocFromManifest(container, [iocManifest])` from the runtime entry.
 *
 * This barrel is deliberately the ESSENTIAL surface only: config authoring types, the runtime
 * registration entry point and its option/override types, the resolution-error family, the
 * manifest types referenced by generated output, and the programmatic codegen entry point.
 * Internal plumbing (manifest path helpers, group-plan builders, report formatters, discovery
 * internals) is importable within the package but no longer exported here.
 */

// Config authoring surface.
export {
  defineIocConfig,
  IOC_CONTRACT_CONFIG_KEY,
  type IocClassConfig,
  type IocConfig,
  type IocContractMetadata,
  type IocDiscoveryScanDirs,
  type IocLifetime,
  type IocOverride,
  type IocRegistrationsPerContract,
  type IocScanDirSpec,
} from "./config/iocConfig.js";

// Group config types referenced from `IocConfig.groups`.
export type {
  IocGroupDefinition,
  IocGroupKind,
  IocGroupsConfig,
} from "./groups/resolveGroupPlan.js";

// Runtime registration entry point and its override types.
export { registerIocFromManifest } from "./runtime/bootstrap.js";
export type {
  ComposedContractOverride,
  ComposedRegistrationOverrides,
} from "./runtime/composedOverrides.js";

// Manifest types referenced by generated output (`ioc-manifest.ts` / `ioc-composed.ts`).
export type {
  IocGeneratedContainerManifest,
  IocModuleNamespace,
  IocRegisterableManifest,
  IocUnitKind,
} from "./core/manifest.js";

// Runtime resolution-error family.
export {
  IocResolutionError,
  isIocResolutionError,
  type IocResolutionFailureType,
  type ResolutionFrame,
} from "./runtime/iocResolutionError.js";

// Programmatic codegen entry point (equivalent of the `ioc generate` CLI).
export { generateManifest } from "./generator/generateManifest.js";
export type { ManifestOptions } from "./generator/manifestOptions.js";
