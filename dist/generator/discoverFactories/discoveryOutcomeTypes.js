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
};
export const IocDiscoveryStatus = {
    DISCOVERED: "discovered",
    SKIPPED: "skipped",
};
//# sourceMappingURL=discoveryOutcomeTypes.js.map