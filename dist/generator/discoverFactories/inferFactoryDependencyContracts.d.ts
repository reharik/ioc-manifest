import ts from "typescript";
/**
 * Infers dependency contract names from the factory's first parameter **object binding pattern**
 * only: for `({ config, logger }: SomeCradleType)`, resolves the type of `config` and `logger` on
 * the parameter type and collects symbols that match known contract names.
 *
 * Does **not** walk all properties of the cradle type (avoids listing the entire container graph).
 * If the first parameter is not a top-level object binding pattern, returns [] (prefer omission).
 */
export declare const inferDependencyContractNames: (checker: ts.TypeChecker, factoryDecl: ts.FunctionLike, knownContractNames: ReadonlySet<string>) => string[];
//# sourceMappingURL=inferFactoryDependencyContracts.d.ts.map