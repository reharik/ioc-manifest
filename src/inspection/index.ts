/**
 * Inspection entry: validate manifests, run discovery analysis, format printable reports.
 */
export {
  buildDiscoveryReport,
  buildGroupReportsFromManifest,
  buildGroupReportsFromPlans,
  buildInspectionReport,
  filterDiscoveryReportByContract,
  filterInspectionReportByContract,
  type BuildInspectionReportOptions,
  type DiscoveryExportReportRow,
  type DiscoveryReport,
  type DiscoveryReportInput,
  type DiscoveryScopeRootRow,
  type DiscoverySummary,
  type GroupRejectionReportRow,
  type InspectionContractReport,
  type InspectionGroupReport,
  type InspectionReport,
} from "./reports.js";

export {
  resolveDiscoveryManifestContext,
  runDiscoveryAnalysis,
  type DiscoveryAnalysisResult,
  type DiscoveryManifestResolution,
} from "./runDiscoveryAnalysis.js";

export {
  formatDiscoveryReport,
  formatInspectionReport,
  type FormatDiscoveryReportOptions,
  type FormatInspectionReportOptions,
} from "./formatReports.js";

export {
  formatDiscoveryReportJson,
  formatInspectionReportJson,
  toDiscoveryReportJson,
  toInspectionReportJson,
  type DiscoveryReportJson,
  type InspectionReportJson,
} from "./reportJson.js";

export {
  glossForSkipReason,
  IOC_DISCOVERY_SKIP_REASON_GLOSS,
  IOC_DISCOVERY_SKIP_REASON_PARTITION,
  isConditionalNearMissReason,
  partitionForSkipReason,
  type DiscoveryRowPartition,
  type NearMissSkipReason,
} from "./skipReasonPartition.js";

export {
  validateManifest,
  type ManifestValidationIssue,
} from "./validateManifest.js";
