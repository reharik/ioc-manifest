/**
 * Inspection entry: validate manifests, run discovery analysis, format printable reports.
 */
export {
  buildDiscoveryReport,
  buildInspectionReport,
  type DiscoveryExportReportRow,
  type DiscoveryReport,
  type DiscoveryReportInput,
  type InspectionContractReport,
  type InspectionReport,
} from "./reports.js";

export {
  runDiscoveryAnalysis,
  type DiscoveryAnalysisResult,
} from "./runDiscoveryAnalysis.js";

export {
  formatDiscoveryReport,
  formatInspectionReport,
} from "./formatReports.js";

export {
  validateManifest,
  type ManifestValidationIssue,
} from "./validateManifest.js";
