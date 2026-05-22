/** Resolved type reference for emission in `ioc-registry.types.ts`. */
export type EmittedTypeReference = {
  typeName: string;
  relImport: string;
  useDefaultImport: boolean;
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
