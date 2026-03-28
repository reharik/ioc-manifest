import ts from "typescript";
export declare const getDiscoveryTargetFiles: (srcDir: string, includePatterns: string[], excludePatterns: string[]) => Promise<string[]>;
export declare const createIocProgramForDiscovery: (projectRoot: string, rootNames: string[]) => ts.Program;
export declare const reportDiscoveryProgramDiagnostics: (program: ts.Program, projectRoot: string, rootNames: readonly string[]) => void;
//# sourceMappingURL=iocProgramContext.d.ts.map