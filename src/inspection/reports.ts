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
import type {
  ScopeRootVariantVerification,
  ScopeRootVerificationResult,
} from "../generator/verifyScopeRoots.js";
import type { ManifestValidationIssue } from "./validateManifest.js";
import { validateManifest } from "./validateManifest.js";

export type DiscoveryReportInput =
  | IocDiscoveryAnalysisFiles
  | {
      discoveryFiles: IocDiscoveryAnalysisFiles;
      /** Omitted by callers that only have per-file outcomes; the scope-root section is then empty. */
      scopeRoots?: readonly DiscoveredScopeRoot[];
      /** Stage-2 verification, matched to variants by (modulePath, exportName). Omitted ⇒ unverified. */
      scopeRootVerification?: ScopeRootVerificationResult;
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

/** Stage-2 verification of one variant, flattened for reporting. */
export type DiscoveryScopeRootVerificationRow = {
  satisfied: boolean;
  /** Keys the subtree demands that no manifest registration supplies. */
  scopeDemands: readonly {
    key: string;
    satisfiedBy: "declared-lbv" | "undeclared" | "type-mismatch";
    via: string;
    demandedTypeText?: string;
    suppliedTypeText?: string;
  }[];
  /**
   * Container-supplied keys this layer could not expand but generation resolves. Rendered as
   * resolved, never as unsatisfied — see the call-site note in `runDiscoveryAnalysis`.
   */
  generationResolvedKeys: readonly { key: string; via: "group"; path: string }[];
  /** Declared lbv keys nothing under the root demands. */
  unusedDeclaredKeys: readonly string[];
  findings: readonly {
    severity: "error" | "warn";
    code: string;
    key: string;
    message: string;
  }[];
};

/** One scope-root variant — the factory identity is what distinguishes variants of a root. */
export type DiscoveryScopeRootVariantRow = {
  variantName: string;
  exportName: string;
  modulePath: string;
  /** The declared lbv type argument as written. The record keeps the raw node; this is its text. */
  declaredLbv: string;
  /**
   * Present only when the caller supplied stage-2 results. Verification is per variant and never
   * merged across the variants of a root contract.
   */
  verification?: DiscoveryScopeRootVerificationRow;
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

/** Flattens one variant's stage-2 result into report rows (no AST, no checker types). */
const toVerificationRow = (
  verification: ScopeRootVariantVerification,
): DiscoveryScopeRootVerificationRow => ({
  satisfied: verification.satisfied,
  scopeDemands: verification.scopeDemands.map((demand) => ({
    key: demand.key,
    satisfiedBy: demand.satisfiedBy,
    via: [...demand.viaPath, demand.key].join(" → "),
    ...(demand.demandedTypeText !== undefined
      ? { demandedTypeText: demand.demandedTypeText }
      : {}),
    ...(demand.suppliedTypeText !== undefined
      ? { suppliedTypeText: demand.suppliedTypeText }
      : {}),
  })),
  generationResolvedKeys: verification.generationResolvedKeys.map((entry) => ({
    key: entry.key,
    via: entry.via,
    path: [...entry.viaPath, entry.key].join(" → "),
  })),
  unusedDeclaredKeys: verification.unusedDeclaredKeys,
  findings: verification.findings.map((finding) => ({
    severity: finding.severity,
    code: finding.code,
    key: finding.key,
    message: finding.message,
  })),
});

/**
 * Groups scope-root units by their root contract. Units sharing a contract are variants of one
 * scope root; the variant is the factory identity, so grouping needs no type-level analysis.
 */
const buildScopeRootRows = (
  units: readonly DiscoveredScopeRoot[],
  verification: ScopeRootVerificationResult | undefined,
): DiscoveryScopeRootRow[] => {
  const byContract = new Map<string, DiscoveryScopeRootRow>();
  // Variant identity — (modulePath, exportName) — is what joins a unit to its verification. Never
  // the contract name: variants of one root have different declarations and different results.
  const verificationByVariant = new Map(
    (verification?.variants ?? []).map((v) => [
      `${v.modulePath} ${v.exportName}`,
      v,
    ]),
  );

  for (const unit of units) {
    const row = byContract.get(unit.contractName) ?? {
      contractName: unit.contractName,
      lifetime: unit.lifetime,
      variants: [] as DiscoveryScopeRootVariantRow[],
    };
    const variantVerification = verificationByVariant.get(
      `${unit.modulePath} ${unit.exportName}`,
    );
    (row.variants as DiscoveryScopeRootVariantRow[]).push({
      variantName: unit.variantName,
      exportName: unit.exportName,
      modulePath: unit.modulePath,
      declaredLbv: unit.lbvTypeText,
      ...(variantVerification !== undefined
        ? { verification: toVerificationRow(variantVerification) }
        : {}),
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
  const scopeRootVerification = isDiscoveryFilesArray(analysisOrFiles)
    ? undefined
    : analysisOrFiles.scopeRootVerification;

  const files = discoveryFiles
    .slice()
    .sort((a, b) => a.modulePath.localeCompare(b.modulePath))
    .map((file) => ({
      modulePath: file.modulePath,
      rows: file.outcomes.flatMap((o) => outcomeToRows(file.modulePath, o)),
    }));

  return {
    files,
    scopeRoots: buildScopeRootRows(scopeRootUnits, scopeRootVerification),
  };
};
