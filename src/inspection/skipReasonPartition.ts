/**
 * @fileoverview Partition and human gloss for discovery skip reasons.
 *
 * The discovery report has two audiences in one screen. A **near-miss** is an export that engaged a
 * convention and then failed — someone wrote a factory or a class unit and did not get a
 * registration, so it is always worth a line. A **not-a-candidate** is a file or export the scan
 * looked at and correctly ignored; it is the overwhelming majority of any real scan and is hidden
 * unless asked for.
 *
 * The partition is an exhaustive `Record` over the reason enum on purpose: adding a skip reason
 * without deciding which side of the screen it belongs on is a type error, not a silent default.
 */
import { IocDiscoverySkipReason } from "../generator/discoverFactories/discoveryOutcomeTypes.js";

/** Which half of the default discovery screen a skipped row belongs to. */
export type DiscoveryRowPartition = "near_miss" | "not_a_candidate";

/**
 * Exhaustive classification of every skip reason.
 *
 * `class_abstract` sits on the not-a-candidate side because `abstract class Base implements C` is
 * the documented base-class pattern — the common case is correct code. It is promoted to a near-miss
 * only under the same condition that makes generation warn: nothing concrete registers that
 * contract. See {@link isConditionalNearMissReason}.
 */
export const IOC_DISCOVERY_SKIP_REASON_PARTITION = {
  no_matching_export: "not_a_candidate",
  no_factory_pattern_in_source: "not_a_candidate",
  excluded_by_config: "not_a_candidate",
  class_abstract: "not_a_candidate",

  invalid_factory_signature: "near_miss",
  contract_not_found: "near_miss",
  contract_not_imported: "near_miss",
  contract_not_resolved: "near_miss",
  unsupported_pattern: "near_miss",
  missing_return_type_annotation: "near_miss",
  contract_annotation_inline_object: "near_miss",
  contract_annotation_anonymous_union: "near_miss",
  class_multiple_implements: "near_miss",
  class_configured_contract_not_implemented: "near_miss",
  class_inherited_contract_not_declared: "near_miss",
  class_invalid_constructor_shape: "near_miss",
  scope_root_wrong_arity: "near_miss",
} as const satisfies Record<IocDiscoverySkipReason, DiscoveryRowPartition>;

/**
 * The reasons the partition record classifies as near-misses, derived from the record itself so the
 * gloss table below cannot drift from the classification.
 */
export type NearMissSkipReason = {
  [K in IocDiscoverySkipReason]: (typeof IOC_DISCOVERY_SKIP_REASON_PARTITION)[K] extends "near_miss"
    ? K
    : never;
}[IocDiscoverySkipReason];

/**
 * Reasons whose partition depends on scan-wide context rather than the reason alone. Today only
 * `class_abstract`: the abstract base is a near-miss exactly when no concrete class in scan range
 * registers its contract, which is the condition `warnUnusableFactoryExports` already uses.
 */
export const isConditionalNearMissReason = (
  reason: IocDiscoverySkipReason,
): reason is typeof IocDiscoverySkipReason.CLASS_ABSTRACT =>
  reason === IocDiscoverySkipReason.CLASS_ABSTRACT;

/**
 * One sentence per near-miss reason: what was found, and what to change. Rendered under the row in
 * the human report; carried per row in `--json`.
 *
 * `class_abstract` carries a gloss even though it is classified not-a-candidate, because the
 * conditional promotion above can put it on the near-miss side.
 */
export const IOC_DISCOVERY_SKIP_REASON_GLOSS = {
  invalid_factory_signature:
    "the export matched the factory prefix but is not a callable factory declaration; make it an exported function or arrow function",
  contract_not_found:
    "the annotated return type names a type this scan cannot locate; check the name and that its declaring file is inside a scan dir",
  contract_not_imported:
    "the annotated return type is not imported in this file; add the type-only import so the contract site resolves",
  contract_not_resolved:
    "the contract site is not a single named type; primitives, arrays, and inline types cannot be contracts",
  unsupported_pattern:
    "the export shape is not a registration unit this version recognises; use a prefixed factory function or a class with an `implements` clause",
  missing_return_type_annotation:
    "the factory has no explicit return type annotation, so there is no contract site to read; annotate the return type",
  contract_annotation_inline_object:
    "the return annotation is an inline object literal; a contract must be a named interface or type alias",
  contract_annotation_anonymous_union:
    "the return annotation is an anonymous union; name it with a type alias so the contract has an identity",
  class_multiple_implements:
    "the class lists more than one `implements` contract, so the contract site is ambiguous; declare exactly one",
  class_configured_contract_not_implemented:
    "`classes[Class].contract` names a type this class does not implement; fix the config entry or the `implements` clause",
  class_inherited_contract_not_declared:
    "the class inherits a contract from its base but declares no `implements` of its own; restate the contract on this class to register it",
  class_invalid_constructor_shape:
    "the constructor is not the single destructured object parameter PROXY injection needs; take one destructured object",
  scope_root_wrong_arity:
    "the `ScopeRoot<...>` marker was written with neither one nor two type arguments; supply the root contract, and the late-bound-value type unless the boundary declares none",
  class_abstract:
    "the class is abstract, so it is never constructed and never registers; add `implements` to the concrete subclass that should register",
} as const satisfies Record<
  NearMissSkipReason | typeof IocDiscoverySkipReason.CLASS_ABSTRACT,
  string
>;

/** The gloss for a reason, or undefined for reasons that carry none (pure not-a-candidate rows). */
export const glossForSkipReason = (
  reason: IocDiscoverySkipReason,
): string | undefined =>
  (
    IOC_DISCOVERY_SKIP_REASON_GLOSS as Readonly<
      Partial<Record<IocDiscoverySkipReason, string>>
    >
  )[reason];

/**
 * Static partition for a reason, before the conditional promotion in {@link isConditionalNearMissReason}
 * is applied by the report builder (which is the only layer that knows the scan-wide context).
 */
export const partitionForSkipReason = (
  reason: IocDiscoverySkipReason,
): DiscoveryRowPartition =>
  (
    IOC_DISCOVERY_SKIP_REASON_PARTITION as Readonly<
      Record<IocDiscoverySkipReason, DiscoveryRowPartition>
    >
  )[reason];
