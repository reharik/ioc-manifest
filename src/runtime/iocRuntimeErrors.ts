export type MissingDefaultContext = {
  contractName: string;
  implementationNames: string[];
  registrationKeys: string[];
};

export const formatMissingDefaultImplementationMessage = (
  ctx: MissingDefaultContext,
): string => {
  const implList = ctx.implementationNames
    .map((n) => JSON.stringify(n))
    .join(", ");
  const keys = ctx.registrationKeys.map((k) => JSON.stringify(k)).join(", ");
  return [
    `[ioc] Multiple implementations for contract ${JSON.stringify(ctx.contractName)} (${implList}) but no default is selected for the contract slot.`,
    `Mark exactly one implementation with default: true (resolver or ioc.config), register exactly one implementation under the camel-cased contract key, or reduce to a single implementation.`,
    `Implementation registration keys: ${keys}.`,
  ].join(" ");
};

export type MissingContractImplementationContext = {
  contractName: string;
  requestedBy?: string;
};

export const formatMissingContractImplementationMessage = (
  ctx: MissingContractImplementationContext,
): string => {
  const who =
    ctx.requestedBy !== undefined && ctx.requestedBy.length > 0
      ? `Requested as ${JSON.stringify(ctx.requestedBy)}. `
      : "";
  return `${who}No implementation is registered for contract ${JSON.stringify(ctx.contractName)}. Add a discoverable factory that returns that contract (or fix ioc.config / discovery globs), then re-run manifest generation.`;
};

export type MissingFactoryExportContext = {
  modulePath: string;
  exportName: string;
  contractName: string;
  registrationKey: string;
};

export const formatMissingFactoryExportMessage = (
  ctx: MissingFactoryExportContext,
): string =>
  [
    `[ioc] Module ${JSON.stringify(ctx.modulePath)} has no callable factory export ${JSON.stringify(ctx.exportName)} for contract ${JSON.stringify(ctx.contractName)} (registration ${JSON.stringify(ctx.registrationKey)}).`,
    `Ensure the export exists at runtime, matches the manifest exportName, and is a function. Re-run manifest generation if the module path or export changed.`,
  ].join(" ");

export type MissingModuleImportContext = {
  moduleIndex: number;
  modulePath: string;
};

export const formatMissingModuleImportMessage = (
  ctx: MissingModuleImportContext,
): string =>
  `[ioc] iocModuleImports[${ctx.moduleIndex}] is missing for source ${JSON.stringify(ctx.modulePath)}. The import array must align with moduleIndex values in the manifest (re-run manifest generation).`;

export type MissingDependencyContext = {
  implementationLabel: string;
  modulePath: string;
  missingContractName: string;
};

export const formatMissingDependencyMessage = (ctx: MissingDependencyContext): string =>
  [
    `[ioc] While building ${ctx.implementationLabel} (${JSON.stringify(ctx.modulePath)}), dependency ${JSON.stringify(ctx.missingContractName)} could not be satisfied.`,
    `Register an implementation for ${JSON.stringify(ctx.missingContractName)} in the manifest, or fix the factory's dependency/cradle usage.`,
  ].join(" ");
