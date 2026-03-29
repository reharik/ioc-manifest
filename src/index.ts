export * from "./core/index.js";
export {
  defineIocConfig,
  type IocConfig,
  type IocLifetime,
  type IocOverride,
} from "./config/iocConfig.js";
export {
  loadIocConfig,
  resolveIocConfigPath,
  tryLoadIocConfig,
} from "./config/loadIocConfig.js";
export * from "./runtime/index.js";

/** Manifest generation (call from your app or a build script). */
export { generateManifest } from "./generator/generateManifest.js";
export type { ManifestOptions } from "./generator/manifestOptions.js";
export {
  DEFAULT_MANIFEST_OPTIONS,
  defaultManifestPathsFromProjectRoot,
  mergeManifestOptionsWithIocConfig,
  resolveManifestOptions,
} from "./generator/manifestOptions.js";
export type { ManifestRuntimePaths } from "./generator/manifestPaths.js";
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
  runDiscoveryAnalysis,
  validateContainerContractsView,
  validateManifest,
  type DiscoveryAnalysisResult,
  type DiscoveryReport,
  type DiscoveryReportInput,
  type InspectionContractsInput,
  type InspectionReport,
  type ManifestValidationIssue,
} from "./inspection/index.js";
export {
  IocDiscoverySkipReason,
  IocDiscoveryStatus,
  type IocDiscoveryAnalysisFiles,
  type IocDiscoveryFileRecord,
  type IocDiscoveryOutcome,
} from "./generator/discoverFactories/discoveryOutcomeTypes.js";
