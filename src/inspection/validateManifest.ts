import { selectDefaultImplementationName } from "../core/defaultImplementationSelection.js";
import type {
  IocContainerContractsView,
  IocContainerImplementationView,
  IocContractManifest,
  ModuleFactoryManifestMetadata,
} from "../core/manifest.js";

export type ManifestValidationIssue = {
  code: string;
  contractName?: string;
  message: string;
};

const collectImpls = (
  impls: Record<string, ModuleFactoryManifestMetadata>,
): ModuleFactoryManifestMetadata[] => Object.values(impls);

export const validateManifest = (
  manifestByContract: IocContractManifest,
): ManifestValidationIssue[] => {
  const issues: ManifestValidationIssue[] = [];

  for (const [contractName, impls] of Object.entries(manifestByContract)) {
    const list = collectImpls(impls);
    if (list.length === 0) {
      issues.push({
        code: "contract_no_implementations",
        contractName,
        message: `Contract ${JSON.stringify(contractName)} has zero implementations in the manifest.`,
      });
      continue;
    }

    for (const row of list) {
      if (row.sourceFilePath !== undefined && row.sourceFilePath !== row.modulePath) {
        issues.push({
          code: "metadata_source_path_mismatch",
          contractName,
          message: `Implementation ${JSON.stringify(row.implementationName)} for ${JSON.stringify(contractName)} has modulePath ${JSON.stringify(row.modulePath)} but sourceFilePath ${JSON.stringify(row.sourceFilePath)} (expected match).`,
        });
      }
    }

    const defaults = list.filter((m) => m.default === true);
    if (defaults.length > 1) {
      issues.push({
        code: "multiple_defaults",
        contractName,
        message: `Contract ${JSON.stringify(contractName)} has more than one implementation marked default: true.`,
      });
      continue;
    }

    try {
      selectDefaultImplementationName(
        contractName,
        list.map((m) => ({
          implementationName: m.implementationName,
          registrationKey: m.registrationKey,
          ...(m.default === true ? { default: true as const } : {}),
        })),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({
        code: "multiple_implementations_no_default",
        contractName,
        message,
      });
    }
  }

  return issues;
};

const collectLeanImpls = (
  impls: Record<string, IocContainerImplementationView>,
): IocContainerImplementationView[] => Object.values(impls);

export const validateContainerContractsView = (
  contracts: IocContainerContractsView,
): ManifestValidationIssue[] => {
  const issues: ManifestValidationIssue[] = [];

  for (const [contractName, impls] of Object.entries(contracts)) {
    const list = collectLeanImpls(impls);
    if (list.length === 0) {
      issues.push({
        code: "contract_no_implementations",
        contractName,
        message: `Contract ${JSON.stringify(contractName)} has zero implementations in the manifest.`,
      });
      continue;
    }

    const implKeys = Object.keys(impls).sort((a, b) => a.localeCompare(b));
    const defaults = implKeys.filter((k) => impls[k]!.default === true);
    if (defaults.length > 1) {
      issues.push({
        code: "multiple_defaults",
        contractName,
        message: `Contract ${JSON.stringify(contractName)} has more than one implementation marked default: true.`,
      });
      continue;
    }

    try {
      selectDefaultImplementationName(
        contractName,
        implKeys.map((k) => {
          const row = impls[k]!;
          return {
            implementationName: k,
            registrationKey: row.registrationKey,
            ...(row.default === true ? { default: true as const } : {}),
          };
        }),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({
        code: "multiple_implementations_no_default",
        contractName,
        message,
      });
    }
  }

  return issues;
};
