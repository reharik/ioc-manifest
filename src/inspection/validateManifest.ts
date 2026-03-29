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
    if (list.length > 1 && defaults.length === 0) {
      issues.push({
        code: "multiple_implementations_no_default",
        contractName,
        message: `Contract ${JSON.stringify(contractName)} has ${list.length} implementations (${list.map((m) => JSON.stringify(m.implementationName)).join(", ")}) but none is marked default: true.`,
      });
    }
    if (defaults.length > 1) {
      issues.push({
        code: "multiple_defaults",
        contractName,
        message: `Contract ${JSON.stringify(contractName)} has more than one implementation marked default: true.`,
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
    if (implKeys.length > 1 && defaults.length === 0) {
      issues.push({
        code: "multiple_implementations_no_default",
        contractName,
        message: `Contract ${JSON.stringify(contractName)} has ${implKeys.length} implementations (${implKeys.map((k) => JSON.stringify(k)).join(", ")}) but none is marked default: true.`,
      });
    }
    if (defaults.length > 1) {
      issues.push({
        code: "multiple_defaults",
        contractName,
        message: `Contract ${JSON.stringify(contractName)} has more than one implementation marked default: true.`,
      });
    }
  }

  return issues;
};
