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

export type DemandSupplyAnalysisResult = {
  /** Demand/supply-derived cradle properties (alphabetically sorted by key). */
  entries: readonly DemandSupplyCradleEntry[];
  /** Keys appearing in {@link entries} with `classification: "external"`. */
  externalKeys: readonly string[];
  /** Keys appearing in {@link entries} with `classification: "scope-provided"`. */
  scopeProvidedKeys: readonly string[];
};
