import ts from "typescript";
/**
 * Best-effort: reads the first parameter type as an object and collects property value types
 * whose symbol name matches a known contract name (from discovery).
 */
export declare const inferDependencyContractNames: (checker: ts.TypeChecker, factoryDecl: ts.FunctionLike, knownContractNames: ReadonlySet<string>) => string[];
//# sourceMappingURL=inferFactoryDependencyContracts.d.ts.map