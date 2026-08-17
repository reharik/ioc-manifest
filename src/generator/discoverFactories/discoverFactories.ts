/**
 * @fileoverview Aggregates per-file factory scans into a contract → implementation map and
 * optionally enriches factories with inferred dependency contract names from the first parameter.
 */
import path from "node:path";
import ts from "typescript";
import type { IocConfig } from "../../config/iocConfig.js";
import type { DiscoveredFactory } from "../types.js";
import {
  resolveFactorySourceAbsPath,
  type FactoryDiscoveryPaths,
} from "../manifestPaths.js";
import {
  IocDiscoverySkipReason,
  IocDiscoveryStatus,
  type IocDiscoveryAnalysisFiles,
  type IocDiscoveryFileRecord,
} from "./discoveryOutcomeTypes.js";
import { collectFileAnalysisForFactoryDiscovery } from "./scanFactoryFile.js";
import { scanFactoryFile } from "./scanFactoryFile.js";
import { inferFactoryDependencies } from "./inferFactoryDependencyContracts.js";

const normalizePath = (p: string): string => path.normalize(p);

const buildSourceFileIndex = (
  program: ts.Program,
): Map<string, ts.SourceFile> => {
  const index = new Map<string, ts.SourceFile>();
  for (const sf of program.getSourceFiles()) {
    index.set(normalizePath(sf.fileName), sf);
  }
  return index;
};

export type FactoryDiscoveryRunOptions = {
  /** When true, collect per-file outcomes for on-demand discovery reports (not written to manifest). */
  collectFileRecords?: boolean;
  /**
   * When true, invalid-annotation outcomes (missing annotation, inline object literal, anonymous
   * union) are recorded as categorized outcomes but do not throw — used by `ioc inspect
   * --discovery` so the report can list every offender. Generation keeps the default (throw).
   */
  tolerateInvalidAnnotations?: boolean;
};

type InvalidAnnotationOffender = {
  modulePath: string;
  exportName: string;
  skipReason: IocDiscoverySkipReason;
};

const INVALID_ANNOTATION_SKIP_REASONS: ReadonlySet<IocDiscoverySkipReason> =
  new Set([
    IocDiscoverySkipReason.MISSING_RETURN_TYPE_ANNOTATION,
    IocDiscoverySkipReason.CONTRACT_ANNOTATION_INLINE_OBJECT,
    IocDiscoverySkipReason.CONTRACT_ANNOTATION_ANONYMOUS_UNION,
  ]);

const invalidAnnotationGuidance = (reason: IocDiscoverySkipReason): string => {
  switch (reason) {
    case IocDiscoverySkipReason.MISSING_RETURN_TYPE_ANNOTATION:
      return "missing return type annotation — add an explicit return type naming the contract";
    case IocDiscoverySkipReason.CONTRACT_ANNOTATION_INLINE_OBJECT:
      return "inline object literal annotation — a contract must be a named type; declare an interface or type alias and use it as the return annotation";
    case IocDiscoverySkipReason.CONTRACT_ANNOTATION_ANONYMOUS_UNION:
      return "anonymous union annotation — name the union with a type alias (e.g. `type Task = EmailTask | SmsTask`) and annotate the factory with the alias";
    default:
      return reason;
  }
};

const formatInvalidAnnotationError = (
  offenders: readonly InvalidAnnotationOffender[],
): string =>
  [
    `[ioc] ${offenders.length} factory export(s) have missing or invalid return type annotations. v3 requires every factory to declare an explicit return type annotation naming its contract:`,
    ...offenders.map(
      (o) =>
        `  - ${o.modulePath} export "${o.exportName}": ${invalidAnnotationGuidance(o.skipReason)}`,
    ),
  ].join("\n");

type ContractDeclSite = {
  declAbsPath: string;
  modulePath: string;
  exportName: string;
};

const formatContractNameCollisionError = (
  collisions: ReadonlyMap<string, readonly ContractDeclSite[]>,
): string => {
  const lines: string[] = [
    `[ioc] Contract name collision: the same contract name is declared in multiple files. Contracts are identified by (declaration file, name); two different declarations cannot share one manifest key. Rename one of the types:`,
  ];
  for (const [contractName, sites] of collisions) {
    lines.push(`  Contract "${contractName}":`);
    for (const site of sites) {
      lines.push(
        `    - declared in "${site.declAbsPath}" (via factory "${site.exportName}" in "${site.modulePath}")`,
      );
    }
  }
  return lines.join("\n");
};

const enrichDependencyContracts = (
  program: ts.Program,
  acceptedFactories: DiscoveredFactory[],
  contractNames: ReadonlySet<string>,
  discoveryPaths: FactoryDiscoveryPaths,
  sourceFileByPath: Map<string, ts.SourceFile>,
): void => {
  if (contractNames.size === 0 || acceptedFactories.length === 0) {
    return;
  }

  const checker = program.getTypeChecker();

  for (const f of acceptedFactories) {
    const absPath = normalizePath(
      resolveFactorySourceAbsPath(
        f.modulePath,
        discoveryPaths.projectRoot,
        discoveryPaths.scanDirs,
      ),
    );
    const sourceFile = sourceFileByPath.get(absPath);
    if (!sourceFile) {
      continue;
    }
    const analysis = collectFileAnalysisForFactoryDiscovery(sourceFile);
    const decl = analysis.factoryDeclByExport.get(f.exportName);
    if (!decl) {
      continue;
    }
    const inferred = inferFactoryDependencies(checker, decl, contractNames);
    if (inferred.contractNames.length > 0) {
      f.dependencyContractNames = inferred.contractNames;
    }
    if (
      inferred.dependencyKeys !== undefined &&
      inferred.dependencyKeys.length > 0
    ) {
      f.dependencyKeys = inferred.dependencyKeys;
    }
  }
};

/**
 * Discovers factories and optionally collects full per-file scan records for analysis tooling.
 */
export const discoverFactories = (
  files: string[],
  program: ts.Program,
  projectRoot: string,
  factoryPrefix: string,
  discoveryPaths: FactoryDiscoveryPaths,
  iocConfig?: IocConfig,
  runOptions?: FactoryDiscoveryRunOptions,
): {
  contractMap: Map<string, Map<string, DiscoveredFactory>>;
  acceptedFactories: DiscoveredFactory[];
  discoveryFiles: IocDiscoveryAnalysisFiles;
} => {
  const checker = program.getTypeChecker();
  const sourceFileByPath = buildSourceFileIndex(program);
  const contractMap = new Map<string, Map<string, DiscoveredFactory>>();
  const registrationKeyOwner = new Map<
    string,
    { modulePath: string; exportName: string }
  >();
  const acceptedFactories: DiscoveredFactory[] = [];
  const collectRecords = runOptions?.collectFileRecords === true;
  const discoveryFiles: IocDiscoveryFileRecord[] = [];
  const invalidAnnotationOffenders: InvalidAnnotationOffender[] = [];
  /** contractName → declaration sites seen (first factory per declaring file). */
  const contractDeclSites = new Map<string, ContractDeclSite[]>();

  for (const abs of files.sort((a, b) => a.localeCompare(b))) {
    const sourceFile = sourceFileByPath.get(normalizePath(abs));
    if (!sourceFile) {
      throw new Error(
        `[ioc] File is not in the TypeScript program (cannot type-check): "${path.relative(projectRoot, abs)}". It may be excluded from tsconfig "include" or matched only by discovery globs — add it to the project or adjust tsconfig.`,
      );
    }
    const fileContext = {
      absPath: abs,
      sourceFile,
      projectRoot,
      factoryPrefix,
      iocConfig,
      paths: {
        projectRoot,
        scanDirs: discoveryPaths.scanDirs,
        generatedDir: discoveryPaths.generatedDir,
      },
    };

    const scan = scanFactoryFile(fileContext, checker);
    if (collectRecords) {
      discoveryFiles.push({
        modulePath: scan.modulePath,
        outcomes: scan.outcomes,
      });
    }

    for (const outcome of scan.outcomes) {
      if (
        outcome.scope === "export" &&
        outcome.status === IocDiscoveryStatus.SKIPPED &&
        INVALID_ANNOTATION_SKIP_REASONS.has(outcome.skipReason)
      ) {
        invalidAnnotationOffenders.push({
          modulePath: scan.modulePath,
          exportName: outcome.exportName,
          skipReason: outcome.skipReason,
        });
      }
    }

    for (const f of scan.discovered) {
      if (f.contractDeclAbsPath !== undefined) {
        const sites = contractDeclSites.get(f.contractName) ?? [];
        if (!sites.some((s) => s.declAbsPath === f.contractDeclAbsPath)) {
          sites.push({
            declAbsPath: f.contractDeclAbsPath,
            modulePath: f.modulePath,
            exportName: f.exportName,
          });
          contractDeclSites.set(f.contractName, sites);
        }
      }
      const existingOwner = registrationKeyOwner.get(f.registrationKey);
      if (existingOwner !== undefined) {
        throw new Error(
          `[ioc] Duplicate registration key ${JSON.stringify(f.registrationKey)}: first export "${existingOwner.exportName}" in "${existingOwner.modulePath}", second export "${f.exportName}" in "${f.modulePath}". Rename exports or adjust ioc.config registrations[contract][implementation].name so Awilix registration keys are globally unique.`,
        );
      }

      const impls =
        contractMap.get(f.contractName) ?? new Map<string, DiscoveredFactory>();
      if (impls.has(f.implementationName)) {
        const existing = impls.get(f.implementationName)!;
        throw new Error(
          `[ioc] Duplicate implementation name ${JSON.stringify(f.implementationName)} for contract "${f.contractName}": first "${existing.exportName}" in "${existing.modulePath}", second "${f.exportName}" in "${f.modulePath}". Implementation names must be unique per contract.`,
        );
      }

      impls.set(f.implementationName, f);
      contractMap.set(f.contractName, impls);
      registrationKeyOwner.set(f.registrationKey, {
        modulePath: f.modulePath,
        exportName: f.exportName,
      });
      acceptedFactories.push(f);
    }
  }

  const aggregatedErrors: string[] = [];

  if (
    invalidAnnotationOffenders.length > 0 &&
    runOptions?.tolerateInvalidAnnotations !== true
  ) {
    aggregatedErrors.push(
      formatInvalidAnnotationError(invalidAnnotationOffenders),
    );
  }

  const collisions = new Map<string, readonly ContractDeclSite[]>();
  for (const [contractName, sites] of contractDeclSites) {
    if (sites.length > 1) {
      collisions.set(contractName, sites);
    }
  }
  if (collisions.size > 0) {
    aggregatedErrors.push(formatContractNameCollisionError(collisions));
  }

  if (aggregatedErrors.length > 0) {
    throw new Error(aggregatedErrors.join("\n"));
  }

  const knownContracts = new Set(contractMap.keys());
  enrichDependencyContracts(
    program,
    acceptedFactories,
    knownContracts,
    discoveryPaths,
    sourceFileByPath,
  );

  const sortedFiles = collectRecords
    ? discoveryFiles
        .slice()
        .sort((a, b) => a.modulePath.localeCompare(b.modulePath))
    : [];

  return {
    contractMap,
    acceptedFactories,
    discoveryFiles: sortedFiles,
  };
};
