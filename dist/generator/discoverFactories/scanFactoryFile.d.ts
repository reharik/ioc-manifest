import ts from "typescript";
import { type IocDiscoveryOutcome } from "./discoveryOutcomeTypes.js";
import type { DiscoveredFactory, FactoryDiscoveryFileContext } from "../types.js";
/** Structural facts about a source file, collected in one AST walk. */
export type FileAnalysis = {
    exportedNames: Set<string>;
    injectableWrappedExports: Set<string>;
    localTypes: Set<string>;
    importedIds: Set<string>;
    factoryDeclByExport: Map<string, ts.FunctionLike>;
};
export declare const collectFileAnalysisForFactoryDiscovery: (sourceFile: ts.SourceFile) => FileAnalysis;
export type ScanFactoryFileResult = {
    sourceFilePath: string;
    outcomes: IocDiscoveryOutcome[];
    discovered: DiscoveredFactory[];
};
export declare const scanFactoryFile: (context: FactoryDiscoveryFileContext, checker: ts.TypeChecker) => ScanFactoryFileResult;
//# sourceMappingURL=scanFactoryFile.d.ts.map