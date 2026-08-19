/**
 * @fileoverview Builds structured reports for inspection: manifest contracts → human-oriented rows,
 * plus discovery-oriented summaries from analyzer inputs.
 */
import { selectDefaultImplementationName } from "../core/defaultImplementationSelection.js";
import type {
  IocContractManifest,
  ModuleFactoryManifestMetadata,
} from "../core/manifest.js";
import type {
  IocDiscoveryAnalysisFiles,
  IocDiscoveryOutcome,
} from "../generator/discoverFactories/discoveryOutcomeTypes.js";
import type { DiscoveredScopeRoot } from "../generator/types.js";
import type { ManifestValidationIssue } from "./validateManifest.js";
import { validateManifest } from "./validateManifest.js";

export type DiscoveryReportInput =
  | IocDiscoveryAnalysisFiles
  | {
      discoveryFiles: IocDiscoveryAnalysisFiles;
      /** Omitted by callers that only have per-file outcomes; the scope-root section is then empty. */
      scopeRoots?: readonly DiscoveredScopeRoot[];
    };

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
  modulePath: string;
  exportName?: string;
  status: "discovered" | "skipped";
  contractName?: string;
  skipReason?: string;
  registrationKey?: string;
  /** Set for `class_inherited_contract_not_declared`: the base whose contract was not restated. */
  baseClassName?: string;
  /** Set when this export is a scope-root unit rather than an ordinary registration. */
  isScopeRoot?: true;
  /** Scope roots only: the declared lbv type argument as written (captured, never resolved). */
  declaredLbv?: string;
};

/** One scope-root variant — the factory identity is what distinguishes variants of a root. */
export type DiscoveryScopeRootVariantRow = {
  variantName: string;
  exportName: string;
  modulePath: string;
  /** The declared lbv type argument as written. Stage 1 never resolves it. */
  declaredLbv: string;
};

/**
 * One scope root, with every factory declaring it as a variant. Reported, not manifest-emitted:
 * stage 1 keeps scope roots out of the registration plan entirely.
 */
export type DiscoveryScopeRootRow = {
  contractName: string;
  lifetime: string;
  variants: readonly DiscoveryScopeRootVariantRow[];
};

export type DiscoveryReport = {
  files: readonly {
    modulePath: string;
    rows: readonly DiscoveryExportReportRow[];
  }[];
  /** Grouped by root contract; empty when the input carried no scope-root rows. */
  scopeRoots: readonly DiscoveryScopeRootRow[];
};

const outcomeToRows = (
  modulePath: string,
  outcome: IocDiscoveryOutcome,
): DiscoveryExportReportRow[] => {
  if (outcome.scope === "file") {
    return [
      {
        modulePath,
        status: "skipped",
        skipReason: outcome.skipReason,
      },
    ];
  }

  if (outcome.status === "discovered") {
    return [
      {
        modulePath,
        exportName: outcome.exportName,
        status: "discovered",
        contractName: outcome.contractName,
        registrationKey: outcome.registrationKey,
        ...(outcome.isScopeRoot === true ? { isScopeRoot: true as const } : {}),
        ...(outcome.declaredLbv !== undefined
          ? { declaredLbv: outcome.declaredLbv }
          : {}),
      },
    ];
  }

  return [
    {
      modulePath,
      exportName: outcome.exportName,
      status: "skipped",
      skipReason: outcome.skipReason,
      contractName: outcome.contractName,
      ...(outcome.baseClassName !== undefined
        ? { baseClassName: outcome.baseClassName }
        : {}),
    },
  ];
};

const isDiscoveryFilesArray = (
  input: DiscoveryReportInput,
): input is IocDiscoveryAnalysisFiles => Array.isArray(input);

/**
 * Groups scope-root units by their root contract. Units sharing a contract are variants of one
 * scope root; the variant is the factory identity, so grouping needs no type-level analysis.
 */
const buildScopeRootRows = (
  units: readonly DiscoveredScopeRoot[],
): DiscoveryScopeRootRow[] => {
  const byContract = new Map<string, DiscoveryScopeRootRow>();

  for (const unit of units) {
    const row = byContract.get(unit.contractName) ?? {
      contractName: unit.contractName,
      lifetime: unit.lifetime,
      variants: [] as DiscoveryScopeRootVariantRow[],
    };
    (row.variants as DiscoveryScopeRootVariantRow[]).push({
      variantName: unit.variantName,
      exportName: unit.exportName,
      modulePath: unit.modulePath,
      declaredLbv: unit.lbvTypeText,
    });
    byContract.set(unit.contractName, row);
  }

  return Array.from(byContract.values())
    .sort((a, b) => a.contractName.localeCompare(b.contractName))
    .map((row) => ({
      ...row,
      variants: [...row.variants].sort((a, b) =>
        a.variantName.localeCompare(b.variantName),
      ),
    }));
};

export const buildDiscoveryReport = (
  analysisOrFiles: DiscoveryReportInput,
): DiscoveryReport => {
  const discoveryFiles: IocDiscoveryAnalysisFiles = isDiscoveryFilesArray(
    analysisOrFiles,
  )
    ? analysisOrFiles
    : analysisOrFiles.discoveryFiles;
  const scopeRootUnits = isDiscoveryFilesArray(analysisOrFiles)
    ? []
    : (analysisOrFiles.scopeRoots ?? []);

  const files = discoveryFiles
    .slice()
    .sort((a, b) => a.modulePath.localeCompare(b.modulePath))
    .map((file) => ({
      modulePath: file.modulePath,
      rows: file.outcomes.flatMap((o) => outcomeToRows(file.modulePath, o)),
    }));

  return { files, scopeRoots: buildScopeRootRows(scopeRootUnits) };
};
