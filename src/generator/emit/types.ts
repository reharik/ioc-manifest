/** Source location of the factory that pulled a type/import into the generated output. */
export type FactorySourceLocation = {
  exportName: string;
  modulePath: string;
  line: number;
  /**
   * Which registration unit kind this location refers to. Absent reads as `"factory"`; used only
   * so diagnostics say "class" and show a constructor-shaped hint for class units.
   */
  unitKind?: "class" | "factory";
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
