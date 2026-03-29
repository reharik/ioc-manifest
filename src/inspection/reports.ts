import { selectDefaultImplementationName } from "../core/defaultImplementationSelection.js";
import type {
  IocContainerContractsView,
  IocContainerImplementationView,
  IocContractManifest,
  ModuleFactoryManifestMetadata,
} from "../core/manifest.js";
import type {
  IocDiscoveryAnalysisFiles,
  IocDiscoveryOutcome,
} from "../generator/discoverFactories/discoveryOutcomeTypes.js";
import type { ManifestValidationIssue } from "./validateManifest.js";
import {
  validateContainerContractsView,
  validateManifest,
} from "./validateManifest.js";

/** Result shape from {@link runDiscoveryAnalysis}; inlined to avoid import cycles. */
export type DiscoveryReportInput =
  | IocDiscoveryAnalysisFiles
  | { discoveryFiles: IocDiscoveryAnalysisFiles };

export type InspectionContractsInput =
  | IocContainerContractsView
  | IocContractManifest;

const isRegistrationManifest = (
  contracts: InspectionContractsInput,
): contracts is IocContractManifest => {
  for (const implMap of Object.values(contracts)) {
    for (const row of Object.values(implMap)) {
      return (
        row != null &&
        typeof row === "object" &&
        "moduleIndex" in row
      );
    }
  }
  return false;
};

export type InspectionContractReport = {
  contractName: string;
  defaultImplementationName: string | undefined;
  defaultRegistrationKey: string | undefined;
  implementations: readonly {
    implementationName: string;
    registrationKey: string;
    lifecycle: string;
    sourceFilePath: string;
    exportName: string;
    isDefault: boolean;
  }[];
};

export type InspectionReport = {
  contracts: readonly InspectionContractReport[];
  manifestIssues: readonly ManifestValidationIssue[];
};

const pickDefaultRegistration = (
  contractName: string,
  impls: Record<string, ModuleFactoryManifestMetadata>,
): { name: string; meta: ModuleFactoryManifestMetadata } | undefined => {
  const list = Object.values(impls);
  if (list.length === 0) {
    return undefined;
  }
  try {
    const name = selectDefaultImplementationName(
      contractName,
      list.map((m) => ({
        implementationName: m.implementationName,
        registrationKey: m.registrationKey,
        ...(m.default === true ? { default: true as const } : {}),
      })),
    );
    const meta = list.find((m) => m.implementationName === name);
    if (meta === undefined) {
      return undefined;
    }
    return { name: meta.implementationName, meta };
  } catch {
    return undefined;
  }
};

const pickDefaultLean = (
  contractName: string,
  impls: Record<string, IocContainerImplementationView>,
): { name: string; meta: IocContainerImplementationView } | undefined => {
  const implKeys = Object.keys(impls).sort((a, b) => a.localeCompare(b));
  if (implKeys.length === 0) {
    return undefined;
  }
  try {
    const name = selectDefaultImplementationName(
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
    const meta = impls[name];
    if (meta === undefined) {
      return undefined;
    }
    return { name, meta };
  } catch {
    return undefined;
  }
};

export const buildInspectionReport = (
  contracts: InspectionContractsInput,
  options?: { registrationManifest?: IocContractManifest },
): InspectionReport => {
  const manifestIssues =
    options?.registrationManifest !== undefined
      ? validateManifest(options.registrationManifest)
      : isRegistrationManifest(contracts)
        ? validateManifest(contracts)
        : validateContainerContractsView(contracts);

  const contractNames = Object.keys(contracts).sort((a, b) =>
    a.localeCompare(b),
  );

  const contractsOut: InspectionContractReport[] = contractNames.map(
    (contractName) => {
      const impls = contracts[contractName]!;
      const implKeys = Object.keys(impls).sort((a, b) => a.localeCompare(b));
      if (isRegistrationManifest(contracts)) {
        const full = impls as Record<string, ModuleFactoryManifestMetadata>;
        const selected = pickDefaultRegistration(contractName, full);
        return {
          contractName,
          defaultImplementationName: selected?.name,
          defaultRegistrationKey: selected?.meta.registrationKey,
          implementations: implKeys.map((k) => {
            const m = full[k]!;
            return {
              implementationName: m.implementationName,
              registrationKey: m.registrationKey,
              lifecycle: m.lifetime,
              sourceFilePath: m.sourceFilePath ?? m.modulePath,
              exportName: m.exportName,
              isDefault: selected?.name === m.implementationName,
            };
          }),
        };
      }
      const lean = impls as Record<string, IocContainerImplementationView>;
      const selected = pickDefaultLean(contractName, lean);
      return {
        contractName,
        defaultImplementationName: selected?.name,
        defaultRegistrationKey: selected?.meta.registrationKey,
        implementations: implKeys.map((k) => {
          const m = lean[k]!;
          return {
            implementationName: k,
            registrationKey: m.registrationKey,
            lifecycle: m.lifetime,
            sourceFilePath: m.sourceFile,
            exportName: m.exportName,
            isDefault: selected?.name === k,
          };
        }),
      };
    },
  );

  return { contracts: contractsOut, manifestIssues };
};

export type DiscoveryExportReportRow = {
  sourceFilePath: string;
  exportName?: string;
  status: "discovered" | "skipped";
  contractName?: string;
  skipReason?: string;
  registrationKey?: string;
};

export type DiscoveryReport = {
  files: readonly {
    sourceFilePath: string;
    rows: readonly DiscoveryExportReportRow[];
  }[];
};

const outcomeToRows = (
  sourceFilePath: string,
  outcome: IocDiscoveryOutcome,
): DiscoveryExportReportRow[] => {
  if (outcome.scope === "file") {
    return [
      {
        sourceFilePath,
        status: "skipped",
        skipReason: outcome.skipReason,
      },
    ];
  }
  if (outcome.status === "discovered") {
    return [
      {
        sourceFilePath,
        exportName: outcome.exportName,
        status: "discovered",
        contractName: outcome.contractName,
        registrationKey: outcome.registrationKey,
      },
    ];
  }
  return [
    {
      sourceFilePath,
      exportName: outcome.exportName,
      status: "skipped",
      skipReason: outcome.skipReason,
      contractName: outcome.contractName,
    },
  ];
};

const isDiscoveryFilesArray = (
  input: DiscoveryReportInput,
): input is IocDiscoveryAnalysisFiles => Array.isArray(input);

export const buildDiscoveryReport = (
  analysisOrFiles: DiscoveryReportInput,
): DiscoveryReport => {
  const discoveryFiles: IocDiscoveryAnalysisFiles = isDiscoveryFilesArray(
    analysisOrFiles,
  )
    ? analysisOrFiles
    : analysisOrFiles.discoveryFiles;

  const files = discoveryFiles
    .slice()
    .sort((a, b) => a.sourceFilePath.localeCompare(b.sourceFilePath))
    .map((file) => ({
      sourceFilePath: file.sourceFilePath,
      rows: file.outcomes.flatMap((o) => outcomeToRows(file.sourceFilePath, o)),
    }));
  return { files };
};
