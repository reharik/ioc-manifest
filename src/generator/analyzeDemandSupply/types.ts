export type FactorySourceLocation = {
  exportName: string;
  modulePath: string;
  line: number;
};

/** Import spec collected for generated `ioc-registry.types.ts`. */
export type TypeImportSpec = {
  typeName: string;
  relImport: string;
  useDefaultImport: boolean;
  /**
   * Factory whose type resolution pulled this import in. Carried for provenance in the
   * escape-root warning; optional because specs for internal/lib paths are built without it.
   */
  sourceFactory?: FactorySourceLocation;
};

/** Resolved type reference for emission in `ioc-registry.types.ts`. */
export type EmittedTypeReference = {
  /** Full property type text (may be compound, e.g. `string | Foo`). */
  typeName: string;
  imports: readonly TypeImportSpec[];
};

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
