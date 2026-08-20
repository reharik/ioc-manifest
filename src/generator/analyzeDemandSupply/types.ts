// These types now live with the emission seam; re-exported here so existing import paths keep
// working for demand/supply consumers.
import type { EmittedTypeReference } from "../emit/index.js";

export type {
  EmittedTypeReference,
  FactorySourceLocation,
  TypeImportSpec,
} from "../emit/index.js";

export type DemandSupplyCradleEntry = {
  key: string;
  typeRef: EmittedTypeReference;
  /**
   * `local` when satisfied by a factory supply or group root key; `external` when demanded but
   * unsatisfied locally; `scope-provided` when demanded but supplied at runtime via scope
   * registration (excluded from the externals-supply check).
   */
  classification: "local" | "external" | "scope-provided";
};

/**
 * One unit that demanded a key, as the walk saw it.
 *
 * Identity is (modulePath, exportName) — the same pair every other join in the generator uses —
 * because a scope-root variant has no registration key to be identified by.
 */
export type DemandingUnitRef = {
  exportName: string;
  modulePath: string;
  /** Absent for scope-root variants, which claim no cradle key. */
  registrationKey?: string;
};

export type DemandSupplyAnalysisResult = {
  /** Demand/supply-derived cradle properties (alphabetically sorted by key). */
  entries: readonly DemandSupplyCradleEntry[];
  /** Keys appearing in {@link entries} with `classification: "external"`. */
  externalKeys: readonly string[];
  /** Keys appearing in {@link entries} with `classification: "scope-provided"`. */
  scopeProvidedKeys: readonly string[];
  /**
   * Every unit that demanded each key, deduplicated, in walk order.
   *
   * The package-wide demand edge set, and the authoritative one: it reads deps through the checker,
   * so it sees properties a destructuring pattern happens to omit. Externals exclusion consumes it
   * to ask whether a demand of a declared late-bound value sits outside the declaring variant's
   * subtree. Nothing else derives a second demand pass from it.
   */
  demandersByKey: ReadonlyMap<string, readonly DemandingUnitRef[]>;
};
