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
  /** v3: prefix-matched factory export without an explicit return type annotation (hard error at generation). */
  MISSING_RETURN_TYPE_ANNOTATION: "missing_return_type_annotation",
  /** v3: return annotation is an inline object literal — a contract must be a named type (hard error at generation). */
  CONTRACT_ANNOTATION_INLINE_OBJECT: "contract_annotation_inline_object",
  /** v3: return annotation is an inline/anonymous union — name it with a type alias (hard error at generation). */
  CONTRACT_ANNOTATION_ANONYMOUS_UNION: "contract_annotation_anonymous_union",
  /** v3: exported class lists more than one `implements` contract (hard error at generation). */
  CLASS_MULTIPLE_IMPLEMENTS: "class_multiple_implements",
  /** v3: `classes[Class].contract` names a type the class does not implement (hard error at generation). */
  CLASS_CONFIGURED_CONTRACT_NOT_IMPLEMENTED:
    "class_configured_contract_not_implemented",
  /** v3: abstract class carrying `implements` — skipped; warned only when nothing concrete registers that contract. */
  CLASS_ABSTRACT: "class_abstract",
  /**
   * v3: concrete class whose `extends` chain reaches a contract, but which declares no `implements`
   * of its own — so it was not registered. Almost always an oversight; warned, never fatal.
   */
  CLASS_INHERITED_CONTRACT_NOT_DECLARED:
    "class_inherited_contract_not_declared",
  /** v3: constructor is not the single destructured object parameter PROXY injection needs (hard error). */
  CLASS_INVALID_CONSTRUCTOR_SHAPE: "class_invalid_constructor_shape",
  /**
   * Scope roots (stage 1): the contract site is written `ScopeRoot<...>` with other than two type
   * arguments. A hard error — writing the marker is an unambiguous declaration attempt, and the
   * missing type argument is the one thing the tool refuses to infer.
   */
  SCOPE_ROOT_WRONG_ARITY: "scope_root_wrong_arity",
} as const;

export type IocDiscoverySkipReason =
  (typeof IocDiscoverySkipReason)[keyof typeof IocDiscoverySkipReason];

export const IocDiscoveryStatus = {
  DISCOVERED: "discovered",
  SKIPPED: "skipped",
} as const;

export type IocDiscoveryStatus =
  (typeof IocDiscoveryStatus)[keyof typeof IocDiscoveryStatus];

/**
 * How an export was matched. `naming` = factory-prefix export with a return annotation;
 * `implements` = exported class whose `implements` clause is the contract site.
 */
export type IocDiscoveryStrategy = "naming" | "implements";

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
      discoveredBy: IocDiscoveryStrategy;
      /**
       * Set when the unit is a scope root (`ScopeRoot<TContract, TLbv>` at the contract site). Such
       * a unit is discovered and reported but, at stage 1, reaches no manifest — `contractName` is
       * the root contract and `registrationKey` is the variant's derived name, not a claimed cradle
       * key. See `docs/design/scope-roots.md`.
       */
      isScopeRoot?: true;
      /** Scope roots only: the declared lbv type argument as written (captured, never resolved). */
      declaredLbv?: string;
    }
  | {
      scope: "export";
      exportName: string;
      status: typeof IocDiscoveryStatus.SKIPPED;
      skipReason: IocDiscoverySkipReason;
      contractName?: string;
      /**
       * `CLASS_INHERITED_CONTRACT_NOT_DECLARED` only: the base class whose declared contract the
       * concrete class did not restate. Carried on the outcome so both consumers — the aggregated
       * generation warning and `ioc inspect --discovery` — can name it without a type checker.
       */
      baseClassName?: string;
    };

export type IocDiscoveryFileRecord = {
  /** Path relative to the project `src/` root (POSIX). */
  modulePath: string;
  outcomes: readonly IocDiscoveryOutcome[];
};

/** Full per-file discovery scan (on-demand analysis only; not code-generated). */
export type IocDiscoveryAnalysisFiles = readonly IocDiscoveryFileRecord[];
