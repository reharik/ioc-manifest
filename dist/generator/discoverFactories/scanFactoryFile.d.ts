import ts from "typescript";
import type { DiscoveredFactory, FactoryDiscoveryFileContext } from "../types.js";
/** Structural facts about a source file, collected in one AST walk. */
export type FileAnalysis = {
    exportedNames: Set<string>;
    injectableWrappedExports: Set<string>;
    localTypes: Set<string>;
    importedIds: Set<string>;
    factoryDeclByExport: Map<string, ts.FunctionLike>;
};
export declare const scanFactoryFile: (context: FactoryDiscoveryFileContext, checker: ts.TypeChecker) => DiscoveredFactory[];
//# sourceMappingURL=scanFactoryFile.d.ts.map