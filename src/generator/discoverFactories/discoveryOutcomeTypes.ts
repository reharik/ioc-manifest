/**
 * Discovery outcome types used by factory scanning and on-demand discovery analysis.
 * Not part of the generated runtime manifest (keeps manifest size bounded).
 */
export const IocDiscoverySkipReason = {
  NO_MATCHING_EXPORT: "no_matching_export",
  NO_FACTORY_PATTERN_IN_SOURCE: "no_factory_pattern_in_source",
  INVALID_FACTORY_SIGNATURE: "invalid_factory_signature",
  CONTRACT_NOT_FOUND: "contract_not_found",
  CONTRACT_NOT_IMPORTED: "contract_not_imported",
  CONTRACT_NOT_RESOLVED: "contract_not_resolved",
  EXCLUDED_BY_CONFIG: "excluded_by_config",
  UNSUPPORTED_PATTERN: "unsupported_pattern",
} as const;

export type IocDiscoverySkipReason =
  (typeof IocDiscoverySkipReason)[keyof typeof IocDiscoverySkipReason];

export const IocDiscoveryStatus = {
  DISCOVERED: "discovered",
  SKIPPED: "skipped",
} as const;

export type IocDiscoveryStatus =
  (typeof IocDiscoveryStatus)[keyof typeof IocDiscoveryStatus];

export type IocDiscoveryOutcome =
  | {
      scope: "file";
      status: typeof IocDiscoveryStatus.SKIPPED;
      skipReason: IocDiscoverySkipReason;
    }
  | {
      scope: "export";
      exportName: string;
      status: typeof IocDiscoveryStatus.DISCOVERED;
      contractName: string;
      implementationName: string;
      registrationKey: string;
      discoveredBy: "naming";
    }
  | {
      scope: "export";
      exportName: string;
      status: typeof IocDiscoveryStatus.SKIPPED;
      skipReason: IocDiscoverySkipReason;
      contractName?: string;
    };

export type IocDiscoveryFileRecord = {
  /** Path relative to the project `src/` root (POSIX). */
  modulePath: string;
  outcomes: readonly IocDiscoveryOutcome[];
};

/** Full per-file discovery scan (on-demand analysis only; not code-generated). */
export type IocDiscoveryAnalysisFiles = readonly IocDiscoveryFileRecord[];
