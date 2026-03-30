import { selectDefaultImplementationName } from "../core/defaultImplementationSelection.js";
import type {
  IocContractManifest,
  ModuleFactoryManifestMetadata,
} from "../core/manifest.js";
import type {
  IocDiscoveryAnalysisFiles,
  IocDiscoveryOutcome,
} from "../generator/discoverFactories/discoveryOutcomeTypes.js";
import type { ManifestValidationIssue } from "./validateManifest.js";
import { validateManifest } from "./validateManifest.js";

export type DiscoveryReportInput =
  | IocDiscoveryAnalysisFiles
  | { discoveryFiles: IocDiscoveryAnalysisFiles };

export type InspectionContractReport = {
  contractName: string;
  defaultImplementationName: string | undefined;
  defaultRegistrationKey: string | undefined;
  implementations: readonly {
    implementationName: string;
    registrationKey: string;
    lifecycle: string;
    modulePath: string;
    exportName: string;
    isDefault: boolean;
  }[];
};

export type InspectionReport = {
  contracts: readonly InspectionContractReport[];
  manifestIssues: readonly ManifestValidationIssue[];
};

const pickDefault = (
  contractName: string,
  impls: Record<string, ModuleFactoryManifestMetadata>,
): { name: string; meta: ModuleFactoryManifestMetadata } | undefined => {
  const list = Object.values(impls);
  if (list.length === 0) return undefined;

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
    return meta ? { name, meta } : undefined;
  } catch {
    return undefined;
  }
};

export const buildInspectionReport = (
  contracts: IocContractManifest,
): InspectionReport => {
  const manifestIssues = validateManifest(contracts);

  const contractNames = Object.keys(contracts).sort((a, b) =>
    a.localeCompare(b),
  );

  const contractsOut: InspectionContractReport[] = contractNames.map(
    (contractName) => {
      const impls = contracts[contractName]!;
      const implKeys = Object.keys(impls).sort((a, b) => a.localeCompare(b));

      const selected = pickDefault(contractName, impls);

      return {
        contractName,
        defaultImplementationName: selected?.name,
        defaultRegistrationKey: selected?.meta.registrationKey,
        implementations: implKeys.map((k) => {
          const m = impls[k]!;
          return {
            implementationName: m.implementationName,
            registrationKey: m.registrationKey,
            lifecycle: m.lifetime,
            modulePath: m.modulePath,
            exportName: m.exportName,
            isDefault: selected?.name === m.implementationName,
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
