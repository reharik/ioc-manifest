/**
 * Public API for **ioc-manifest**: contract-first factory discovery, generated Awilix manifests,
 * runtime registration, grouped injections, and inspection helpers.
 *
 * Typical flow: define IoC config (`defineIocConfig` / `ioc.config.ts`), run
 * `generateManifest()` (or the `gen:manifest` script), import the emitted manifest module,
 * then call `registerIocFromManifest(container, iocManifest)` from the runtime entry.
 */
export * from "./core/index.js";

export {
  defineIocConfig,
  getContractLevelConfig,
  getImplOverrideForImplementation,
  IOC_CONTRACT_CONFIG_KEY,
  isIocImplementationOverride,
  parseContractLevelConfig,
  type IocConfig,
  type IocContractMetadata,
  type IocDiscoveryScanDirs,
  type IocLifetime,
  type IocOverride,
  type IocRegistrationsPerContract,
  type IocScanDirImportMode,
  type IocScanDirSpec,
} from "./config/iocConfig.js";

export { parseDiscoveryScanDirs } from "./config/parseDiscoveryScanDirs.js";

export {
  loadIocConfig,
  resolveIocConfigPath,
  resolveProjectRootFromIocConfigPath,
  tryLoadIocConfig,
} from "./config/loadIocConfig.js";

export * from "./runtime/index.js";

export { generateManifest } from "./generator/generateManifest.js";
export type { ManifestOptions } from "./generator/manifestOptions.js";
export {
  DEFAULT_MANIFEST_OPTIONS,
  defaultManifestPathsFromProjectRoot,
  mergeManifestOptionsWithIocConfig,
  resolveManifestOptions,
} from "./generator/manifestOptions.js";

export {
  computeManifestModuleSpecifier,
  findResolvedScanDirForFile,
  generatedExcludePatternForScanRoot,
  resolveScanDirEntries,
  type ManifestRuntimePaths,
  type ResolvedScanDir,
} from "./generator/manifestPaths.js";

export {
  analyzeGroupPlan,
  buildGroupPlan,
  formatGroupPlanIssue,
  formatGroupPlanIssues,
  groupPlanToManifestNode,
  type GroupDiscoveryBuildContext,
  type GroupPlan,
  type GroupPlanAnalysis,
  type GroupPlanIssue,
  type GroupPlanResult,
  type IocGroupDefinition,
  type IocGroupKind,
  type IocGroupsConfig,
} from "./groups/resolveGroupPlan.js";

export type {
  AssignableImplementationMember,
  ContractDefaultGroupMember,
} from "./groups/baseTypeAssignability.js";

export { shouldIncludeImplInCollectionGroup } from "./groups/baseTypeAssignability.js";

export {
  buildDiscoveryReport,
  buildInspectionReport,
  formatDiscoveryReport,
  formatInspectionReport,
  resolveDiscoveryManifestContext,
  runDiscoveryAnalysis,
  validateManifest,
  type DiscoveryAnalysisResult,
  type DiscoveryManifestResolution,
  type DiscoveryReport,
  type DiscoveryReportInput,
  type FormatDiscoveryReportOptions,
  type InspectionReport,
  type ManifestValidationIssue,
} from "./inspection/index.js";
