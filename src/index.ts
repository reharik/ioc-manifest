export * from "./core/index.js";
export {
  defineIocConfig,
  type IocConfig,
  type IocLifetime,
  type IocOverride,
} from "./config/iocConfig.js";
export {
  type IocBundleLeaf,
  type IocBundleNode,
  type IocBundleReference,
  type IocBundlesConfig,
} from "./bundles/index.js";
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
  analyzeBundlePlan,
  buildBundlePlan,
  formatBundlePlanIssue,
  formatBundlePlanIssues,
  type BundlePlanAnalysis,
  type BundlePlanIssue,
  type BundlePlanResult,
} from "./bundles/resolveBundlePlan.js";
export {
  buildBundleReport,
  buildDiscoveryReport,
  buildInspectionReport,
  bundleIssuesFromAnalysis,
  formatBundleReport,
  formatDiscoveryReport,
  formatInspectionReport,
  runDiscoveryAnalysis,
  validateContainerContractsView,
  validateManifest,
  type BundleReport,
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
