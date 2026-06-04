/** Import spec collected for generated `ioc-registry.types.ts`. */
export type TypeImportSpec = {
  typeName: string;
  relImport: string;
  useDefaultImport: boolean;
};

/** Resolved type reference for emission in `ioc-registry.types.ts`. */
export type EmittedTypeReference = {
  /** Full property type text (may be compound, e.g. `string | Foo`). */
  typeName: string;
  imports: readonly TypeImportSpec[];
};

export type FactorySourceLocation = {
  exportName: string;
  modulePath: string;
  line: number;
};

export type DemandSupplyCradleEntry = {
  key: string;
  typeRef: EmittedTypeReference;
  /** `local` when satisfied by a factory supply or group root key; otherwise `external`. */
  classification: "local" | "external";
};

export type DemandSupplyAnalysisResult = {
  /** Demand/supply-derived cradle properties (alphabetically sorted by key). */
  entries: readonly DemandSupplyCradleEntry[];
  /** Keys appearing in {@link entries} with `classification: "external"`. */
  externalKeys: readonly string[];
};
