/**
 * @fileoverview Static checks on an in-memory `IocContractManifest` (no filesystem). Complements
 * runtime registration: catches ambiguous defaults before `container.resolve`.
 */
import { selectDefaultImplementationName } from "../core/defaultImplementationSelection.js";
import type {
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

    const defaults = list.filter((meta) => meta.default === true);
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
        list.map((meta) => ({
          implementationName: meta.implementationName,
          registrationKey: meta.registrationKey,
          ...(meta.default === true ? { default: true as const } : {}),
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
