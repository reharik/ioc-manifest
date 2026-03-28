export type MissingDefaultContext = {
    contractName: string;
    implementationNames: string[];
    registrationKeys: string[];
};
export declare const formatMissingDefaultImplementationMessage: (ctx: MissingDefaultContext) => string;
export type MissingContractImplementationContext = {
    contractName: string;
    requestedBy?: string;
};
export declare const formatMissingContractImplementationMessage: (ctx: MissingContractImplementationContext) => string;
export type MissingFactoryExportContext = {
    modulePath: string;
    exportName: string;
    contractName: string;
    registrationKey: string;
};
export declare const formatMissingFactoryExportMessage: (ctx: MissingFactoryExportContext) => string;
export type MissingModuleImportContext = {
    moduleIndex: number;
    modulePath: string;
};
export declare const formatMissingModuleImportMessage: (ctx: MissingModuleImportContext) => string;
export type MissingDependencyContext = {
    implementationLabel: string;
    modulePath: string;
    missingContractName: string;
};
export declare const formatMissingDependencyMessage: (ctx: MissingDependencyContext) => string;
//# sourceMappingURL=iocRuntimeErrors.d.ts.map