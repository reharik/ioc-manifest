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
  type IocLifetime,
  type IocOverride,
  type IocRegistrationsPerContract,
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

/** Groups (keep — user-facing feature) */
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

/** Inspection / reporting (canonical manifest only) */
export {
  buildDiscoveryReport,
  buildInspectionReport,
  formatDiscoveryReport,
  formatInspectionReport,
  runDiscoveryAnalysis,
  validateManifest,
  type DiscoveryAnalysisResult,
  type DiscoveryReport,
  type DiscoveryReportInput,
  type InspectionReport,
  type ManifestValidationIssue,
} from "./inspection/index.js";
