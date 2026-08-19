/**
 * @fileoverview `--json` payloads for `ioc inspect` and `ioc inspect --discovery`.
 *
 * These shapes are public CLI API in the same sense `ioc validate --json` is: key names are stable,
 * codes are verbatim, and new fields are added rather than renamed.
 *
 * The JSON is the **complete** record. Unlike the human screen it is not partitioned: every row is
 * present, including `not_a_candidate` ones, each carrying its own `partition` label so a consumer
 * can do the split itself. `--verbose` therefore changes nothing about `--json` output — the two
 * flags are orthogonal by construction, and `--json --verbose` is byte-identical to `--json`.
 *
 * `--contract` is the one filter that does reach the JSON, because it is an explicit narrowing the
 * caller asked for. When it is applied, `filter.contract` is present and `summary` still reports the
 * full scan.
 *
 * @example inspect --json
 * ```json
 * {
 *   "kind": "inspect",
 *   "contracts": [
 *     {
 *       "contractName": "MediaStorage",
 *       "defaultImplementationName": "local",
 *       "defaultRegistrationKey": "localMediaStorage",
 *       "implementations": [
 *         {
 *           "implementationName": "local",
 *           "registrationKey": "localMediaStorage",
 *           "lifecycle": "singleton",
 *           "modulePath": "src/media/buildLocalMediaStorage.ts",
 *           "exportName": "buildLocalMediaStorage",
 *           "isDefault": true
 *         }
 *       ]
 *     }
 *   ],
 *   "manifestIssues": [],
 *   "groups": [
 *     {
 *       "groupName": "mediaStoragesGroup",
 *       "kind": "collection",
 *       "baseType": "MediaStorage",
 *       "members": [{ "memberName": "MediaStorage", "registrationKey": "localMediaStorage" }],
 *       "rejections": [],
 *       "rejectionsUnavailable": true
 *     }
 *   ],
 *   "totalContractCount": 1
 * }
 * ```
 *
 * @example inspect --discovery --json
 * ```json
 * {
 *   "kind": "inspect-discovery",
 *   "files": [
 *     {
 *       "modulePath": "src/channels/emailChannel.ts",
 *       "rows": [
 *         {
 *           "modulePath": "src/channels/emailChannel.ts",
 *           "exportName": "buildEmailChannel",
 *           "status": "discovered",
 *           "contractName": "IChannel",
 *           "registrationKey": "emailChannel",
 *           "lifetime": "scoped",
 *           "lifetimeSource": "lifetime-marker"
 *         },
 *         {
 *           "modulePath": "src/channels/emailChannel.ts",
 *           "exportName": "buildSmsChannel",
 *           "status": "skipped",
 *           "skipReason": "contract_not_imported",
 *           "partition": "near_miss",
 *           "gloss": "the annotated return type is not imported in this file"
 *         }
 *       ]
 *     }
 *   ],
 *   "scopeRoots": [],
 *   "groups": [],
 *   "excludedByConfig": ["util/legacyChannel.ts"],
 *   "summary": {
 *     "filesScanned": 1,
 *     "unitsDiscovered": 1,
 *     "nearMisses": 1,
 *     "notACandidateFiles": 0,
 *     "filesExcludedByConfig": 1
 *   }
 * }
 * ```
 */
import type {
  DiscoveryExportReportRow,
  DiscoveryReport,
  DiscoveryScopeRootRow,
  DiscoverySummary,
  InspectionContractReport,
  InspectionGroupReport,
  InspectionReport,
} from "./reports.js";
import type { ManifestValidationIssue } from "./validateManifest.js";

/** `ioc inspect --json`. */
export type InspectionReportJson = {
  readonly kind: "inspect";
  readonly contracts: readonly InspectionContractReport[];
  readonly manifestIssues: readonly ManifestValidationIssue[];
  readonly groups: readonly InspectionGroupReport[];
  readonly totalContractCount: number;
  readonly filter?: { readonly contract: string };
};

/** `ioc inspect --discovery --json`. */
export type DiscoveryReportJson = {
  readonly kind: "inspect-discovery";
  readonly files: readonly {
    readonly modulePath: string;
    readonly rows: readonly DiscoveryExportReportRow[];
  }[];
  readonly scopeRoots: readonly DiscoveryScopeRootRow[];
  readonly groups: readonly InspectionGroupReport[];
  /**
   * Module paths `discovery.excludes` kept out of the scan. Always present (empty when the config
   * excludes nothing), and never narrowed by `--contract`.
   */
  readonly excludedByConfig: readonly string[];
  readonly summary: DiscoverySummary;
  readonly filter?: { readonly contract: string };
};

export const toInspectionReportJson = (
  report: InspectionReport,
): InspectionReportJson => ({
  kind: "inspect",
  contracts: report.contracts,
  manifestIssues: report.manifestIssues,
  groups: report.groups,
  totalContractCount: report.totalContractCount,
  ...(report.filter !== undefined ? { filter: report.filter } : {}),
});

export const toDiscoveryReportJson = (
  report: DiscoveryReport,
): DiscoveryReportJson => ({
  kind: "inspect-discovery",
  files: report.files,
  scopeRoots: report.scopeRoots,
  groups: report.groups,
  excludedByConfig: report.excludedByConfig,
  summary: report.summary,
  ...(report.filter !== undefined ? { filter: report.filter } : {}),
});

export const formatInspectionReportJson = (report: InspectionReport): string =>
  JSON.stringify(toInspectionReportJson(report), null, 2);

export const formatDiscoveryReportJson = (report: DiscoveryReport): string =>
  JSON.stringify(toDiscoveryReportJson(report), null, 2);
