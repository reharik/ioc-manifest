/**
 * @fileoverview Aggregates per-file factory scans into a contract → implementation map and
 * optionally enriches factories with inferred dependency contract names from the first parameter.
 */
import path from "node:path";
import ts from "typescript";
import type { IocConfig } from "../../config/iocConfig.js";
import type { DiscoveredFactory, DiscoveredScopeRoot } from "../types.js";
import {
  resolveAnnotationContract,
  SCOPE_ROOT_MARKER_FORM,
  unitContractSiteTypeNode,
  type NonNameImportableContractSite,
} from "./contractSite.js";
import { docsPointerLine } from "../../diagnostics/errorDocs.js";
import { formatAggregatedOffenders } from "../../diagnostics/offenderLayout.js";
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
import {
  classImplementsContractNames,
  collectFileAnalysisForFactoryDiscovery,
  scanFactoryFile,
} from "./scanFactoryFile.js";
import { unitDepsSignatureDecl } from "./contractSite.js";
import {
  inferFactoryDependencies,
  type DependencyKeysUnknownShape,
} from "./inferFactoryDependencyContracts.js";

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
   * When true, unregisterable-unit outcomes (missing annotation, inline object literal, anonymous
   * union, and the class-unit failures: multiple `implements`, unimplemented configured contract,
   * non-injectable constructor) are recorded as categorized outcomes but do not throw — used by
   * `ioc inspect --discovery` so the report can list every offender. Generation keeps the default
   * (throw).
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

type ScopeRootOffender = {
  modulePath: string;
  exportName: string;
};

/**
 * Wrong-arity `ScopeRoot` is a hard error, not a categorized skip. Writing the marker at all is an
 * unambiguous attempt to declare a scope root; a missing contract argument, or arguments the marker
 * does not have, is precisely what the tool refuses to guess at, so it must be demanded rather than
 * worked around. The lbv argument is the one that may be omitted — the marker's own default says
 * what omitting it declares (the empty set), so nothing is being inferred there.
 */
const formatScopeRootArityError = (
  offenders: readonly ScopeRootOffender[],
): string =>
  [
    `[ioc] ${offenders.length} factory export(s) annotate a scope root with the wrong number of type arguments. The scope-root marker is written \`${SCOPE_ROOT_MARKER_FORM}\`: the first type argument is the root contract resolved from the scope, the second is the declared object type of the scope's late-bound values (e.g. \`ScopeRoot<IRouter, { viewerId: ViewerId }>\`). The second may be omitted to declare a boundary with no late-bound values (\`ScopeRoot<IRouter>\`), which is a declaration of the empty set — the set is declared, never inferred from the resolution subtree. See docs/design/scope-roots.md:`,
    ...offenders.map((o) => `  - ${o.modulePath} export "${o.exportName}"`),
  ].join("\n");

/**
 * The one code in this family, spelled as both the discovery report's skip reason and the bracketed
 * code on the aggregated error's offender line — one string, so a reader who has either in hand
 * looks the rule up the same way.
 */
const DEFAULT_EXPORT_CONTRACT_CODE = "contract_annotation_default_export";

type DefaultExportContractOffender = {
  modulePath: string;
  exportName: string;
  unitKind: "factory" | "class";
  site: NonNameImportableContractSite;
  line: number;
};

/**
 * Re-reads a refused contract site for the facts the error names.
 *
 * The scan carried the skip reason and the written name; the module the binding came from and the
 * form it is published in live on the AST, and are re-derived here for the same reason
 * {@link classOffenderDetail} re-derives its contract list — the outcome record is a report row, and
 * widening it to carry every error's evidence would make the row about the error.
 */
const defaultExportContractSite = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  exportName: string,
):
  | {
      site: NonNameImportableContractSite;
      unitKind: "factory" | "class";
      line: number;
    }
  | undefined => {
  const analysis = collectFileAnalysisForFactoryDiscovery(sourceFile);
  const unit = analysis.unitDeclByExport.get(exportName);
  if (unit === undefined) {
    return undefined;
  }
  const contractSite = unitContractSiteTypeNode(checker, unit);
  if (contractSite === undefined) {
    return undefined;
  }
  const resolution = resolveAnnotationContract(checker, contractSite);
  if (resolution.kind !== "default_export_contract") {
    return undefined;
  }
  const { line } = sourceFile.getLineAndCharacterOfPosition(
    contractSite.getStart(),
  );
  return { site: resolution, unitKind: unit.unitKind, line: line + 1 };
};

/**
 * The claim sentence, which is where the three forms diverge: a foreign default export, a foreign
 * `export =`, and this project's own `export default` are one rule met in three places.
 */
const defaultExportClaim = (
  site: NonNameImportableContractSite,
  projectRoot: string,
): string => {
  switch (site.form) {
    case "export-default":
      return `Annotates \`${site.writtenName}\`, which ${JSON.stringify(site.foreignModule)} publishes only as its default export.`;
    case "export-equals":
      return `Annotates \`${site.writtenName}\`, which ${JSON.stringify(site.foreignModule)} publishes through \`export =\`, under no importable name.`;
    case "local-default-export":
      return `Annotates \`${site.writtenName}\`, declared in ${JSON.stringify(moduleLabel(site, projectRoot))} and published as that file's default export, so its exported name is \`default\`.`;
  }
};

/** Foreign specifiers stay as written; a path is shown relative to the project it belongs to. */
const moduleLabel = (
  site: NonNameImportableContractSite,
  projectRoot: string,
): string =>
  site.form === "local-default-export"
    ? path.relative(projectRoot, site.foreignModule)
    : site.foreignModule;

/**
 * The edit, written out against the offender's own names.
 *
 * Foreign types get the field guide's wrapper — an empty extending interface in a file of yours,
 * which is a named declaration and is all contract identity ever asked for. A local declaration gets
 * the smaller edit instead: it already has a name, it is only published without one.
 */
const defaultExportGuidance = (
  site: NonNameImportableContractSite,
): readonly string[] => {
  if (site.form === "local-default-export") {
    return [
      `Export the declaration under its name: \`export class ${site.writtenName} { … }\` (or \`export interface\`) rather than \`export default\`.`,
      "`export default` publishes a declaration under the name `default`, which is not a name a contract can be identified by.",
    ];
  }
  return [
    `Wrap it locally and annotate with the wrapper: \`import type ${site.writtenName} from ${JSON.stringify(site.foreignModule)}; export interface ${site.writtenName}Contract extends ${site.writtenName} {}\`.`,
    "One wrapper per foreign type, not per factory: two local names for one foreign type are two contracts.",
  ];
};

const formatDefaultExportContractError = (
  offenders: readonly DefaultExportContractOffender[],
  projectRoot: string,
): string =>
  formatAggregatedOffenders(
    `[ioc] ${offenders.length} contract site${offenders.length === 1 ? "" : "s"} name${offenders.length === 1 ? "s" : ""} a type that has no importable name of its own. A contract is identified by the name written at its site resolved to the declaration it names, and a declaration published only as \`export default\` — or through \`export =\` — offers no such name: a default export is exported under the reserved word \`default\`, which nothing can import and the generated registry file cannot print. What is left at the site is the importer's local alias, which is a fact about the importing file rather than about the contract:`,
    docsPointerLine(DEFAULT_EXPORT_CONTRACT_CODE),
    offenders.map((o) => ({
      code: DEFAULT_EXPORT_CONTRACT_CODE,
      claim: defaultExportClaim(o.site, projectRoot),
      fields: [
        {
          label: o.unitKind === "class" ? "class" : "factory",
          value: JSON.stringify(o.exportName),
        },
        { label: "site", value: `${o.modulePath}:${o.line}` },
        { label: "annotates", value: o.site.writtenName },
        {
          label:
            o.site.form === "local-default-export" ? "declared in" : "module",
          value: JSON.stringify(moduleLabel(o.site, projectRoot)),
        },
        {
          label: "resolves to",
          value:
            o.site.form === "export-equals"
              ? "the `export =` binding, which no named import reaches"
              : '"default" — the export name, not a binding',
        },
      ],
      guidance: defaultExportGuidance(o.site),
    })),
  );

/** Class-unit skips that mean "matched the trigger, cannot be registered" — never silent. */
const CLASS_HARD_ERROR_SKIP_REASONS: ReadonlySet<IocDiscoverySkipReason> =
  new Set([
    IocDiscoverySkipReason.CLASS_MULTIPLE_IMPLEMENTS,
    IocDiscoverySkipReason.CLASS_CONFIGURED_CONTRACT_NOT_IMPLEMENTED,
    IocDiscoverySkipReason.CLASS_INVALID_CONSTRUCTOR_SHAPE,
  ]);

type ClassUnitOffender = {
  modulePath: string;
  exportName: string;
  skipReason: IocDiscoverySkipReason;
  detail: string;
};

const classOffenderDetail = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  exportName: string,
  skipReason: IocDiscoverySkipReason,
  configuredContract: string | undefined,
): string => {
  switch (skipReason) {
    case IocDiscoverySkipReason.CLASS_MULTIPLE_IMPLEMENTS: {
      const contracts = implementsNamesForExport(
        checker,
        sourceFile,
        exportName,
      );
      const list = contracts.map((c) => JSON.stringify(c)).join(" and ");
      return `implements ${contracts.length} contracts (${list}) — a registration unit has exactly one contract. Pick the intended one with classes[${JSON.stringify(exportName)}].contract in ioc.config.ts, or drop the extra \`implements\` entry.`;
    }
    case IocDiscoverySkipReason.CLASS_CONFIGURED_CONTRACT_NOT_IMPLEMENTED: {
      const contracts = implementsNamesForExport(
        checker,
        sourceFile,
        exportName,
      );
      const list = contracts.map((c) => JSON.stringify(c)).join(", ");
      return `classes[${JSON.stringify(exportName)}].contract is ${JSON.stringify(configuredContract ?? "")}, which the class does not implement. Implemented contracts: ${list.length > 0 ? list : "(none)"}.`;
    }
    case IocDiscoverySkipReason.CLASS_INVALID_CONSTRUCTOR_SHAPE:
      return "constructor is not injectable — PROXY-mode injection passes the cradle as one object argument, so a class unit takes either no constructor, a zero-parameter constructor, or exactly one destructured object parameter typed with a named deps type (e.g. `constructor({ logger }: MyDeps)`). Multiple parameters, rest parameters, parameter properties, and primitive/array/function parameter types are CLASSIC-mode injection, which is not supported.";
    default:
      return skipReason;
  }
};

const implementsNamesForExport = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  exportName: string,
): readonly string[] => {
  const analysis = collectFileAnalysisForFactoryDiscovery(sourceFile);
  const unit = analysis.unitDeclByExport.get(exportName);
  if (unit === undefined || unit.unitKind !== "class") {
    return [];
  }
  return classImplementsContractNames(checker, unit.decl);
};

const formatClassUnitError = (
  offenders: readonly ClassUnitOffender[],
): string =>
  [
    `[ioc] ${offenders.length} exported class(es) match the class registration trigger (an \`implements\` clause) but cannot be registered:`,
    ...offenders.map(
      (o) => `  - ${o.modulePath} class "${o.exportName}": ${o.detail}`,
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

/**
 * Units whose deps parameter is enriched with inferred contracts and cradle keys. Scope roots take
 * the same enrichment as ordinary factories (stage 2): the row shape differs, the deps analysis does
 * not, and the inferred `dependencyKeys` are the entry edge of the scope-root subtree walk.
 */
type DependencyEnrichable = Pick<
  DiscoveredFactory,
  | "modulePath"
  | "exportName"
  | "dependencyContractNames"
  | "dependencyKeys"
  | "dependencyKeysUnknown"
>;

/**
 * One accepted unit whose demand set could not be read, with everything a message needs to send the
 * author to the exact line.
 *
 * Accepted is the point. These units register, resolve and run; what they do not do is tell the
 * generator what they demand — so the lifetime check skips them, the scope-root walk stops at them,
 * and the manifest withholds its coverage claim on their account. Until this record existed the
 * only party that never heard about any of that was the one who could fix it.
 */
export type UnknownDependencyKeysUnit = {
  modulePath: string;
  exportName: string;
  /** How the unit is spoken about in the message: an ordinary unit, or a scope-root variant. */
  unitLabel: string;
  /** Which written shape defeated the analysis. */
  shape: DependencyKeysUnknownShape;
  /** The offending parameter, verbatim from the source, when there was one to read. */
  parameterText?: string;
  /** 1-based line of the parameter (or of the unit, when the parameter is what is missing). */
  line?: number;
};

/** 1-based line of `node` in its file, for a `path:line` the editor can jump to. */
const lineOf = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

const enrichDependencyContracts = (
  program: ts.Program,
  acceptedFactories: readonly DependencyEnrichable[],
  contractNames: ReadonlySet<string>,
  discoveryPaths: FactoryDiscoveryPaths,
  sourceFileByPath: Map<string, ts.SourceFile>,
  unknownOut: UnknownDependencyKeysUnit[],
  unitLabel: string,
): void => {
  // Only the unit list can make this a no-op. `contractNames` narrows which dependencies are named
  // as CONTRACTS; it says nothing about the cradle KEYS, which are binding names and are inferred
  // whether or not any of them happens to resolve to a discovered contract. Gating on it as well
  // used to leave a package with no local contracts — a thin composition app, say — with no
  // dependency keys at all, and therefore with a scope-root subtree walk that never left the root.
  if (acceptedFactories.length === 0) {
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
      // Nothing was read, so nothing is known — including whether this unit demands anything. A
      // silent `continue` here is what let the manifest claim full key coverage over units it had
      // never opened.
      f.dependencyKeysUnknown = true;
      unknownOut.push({
        modulePath: f.modulePath,
        exportName: f.exportName,
        unitLabel,
        shape: "unresolvable-signature",
      });
      continue;
    }
    const analysis = collectFileAnalysisForFactoryDiscovery(sourceFile);
    const unit = analysis.unitDeclByExport.get(f.exportName);
    if (!unit) {
      f.dependencyKeysUnknown = true;
      unknownOut.push({
        modulePath: f.modulePath,
        exportName: f.exportName,
        unitLabel,
        shape: "unresolvable-signature",
      });
      continue;
    }
    // Same deps path for both unit kinds: a class's constructor is a `ts.FunctionLike`, so the
    // factory-parameter analyzer reads it unchanged.
    const decl = unitDepsSignatureDecl(unit);
    if (!decl) {
      // Only a class with no constructor lands here, and a class with no constructor takes nothing
      // from the cradle. Determined, and empty — not unknown.
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
    if (inferred.dependencyKeysUnknown === true) {
      f.dependencyKeysUnknown = true;
      const paramNode = decl.parameters[0];
      unknownOut.push({
        modulePath: f.modulePath,
        exportName: f.exportName,
        unitLabel,
        shape: inferred.dependencyKeysUnknownShape ?? "unresolvable-signature",
        ...(paramNode !== undefined
          ? {
              parameterText: paramNode.getText(sourceFile),
              line: lineOf(sourceFile, paramNode),
            }
          : { line: lineOf(sourceFile, decl) }),
      });
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
  /**
   * Scope-root units, in scan order. Deliberately NOT merged into `contractMap` /
   * `acceptedFactories`: at stage 1 a scope root claims no cradle key and reaches no manifest, so
   * it must not enter the registration plan. Units sharing a root contract are variants of one
   * scope root, distinguished by `variantName` / (`modulePath`, `exportName`).
   */
  scopeRoots: DiscoveredScopeRoot[];
  /**
   * Accepted units — factories, classes and scope-root variants alike — whose deps parameter could
   * not be read, in scan order. Reported by generation; see `reportUnknownDependencyKeys.ts`.
   */
  unknownDependencyKeyUnits: UnknownDependencyKeysUnit[];
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
  const classUnitOffenders: ClassUnitOffender[] = [];
  const scopeRootOffenders: ScopeRootOffender[] = [];
  const defaultExportOffenders: DefaultExportContractOffender[] = [];
  const scopeRoots: DiscoveredScopeRoot[] = [];
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
        outcome.scope !== "export" ||
        outcome.status !== IocDiscoveryStatus.SKIPPED
      ) {
        continue;
      }
      if (
        outcome.skipReason === IocDiscoverySkipReason.SCOPE_ROOT_WRONG_ARITY
      ) {
        scopeRootOffenders.push({
          modulePath: scan.modulePath,
          exportName: outcome.exportName,
        });
        continue;
      }
      if (
        outcome.skipReason ===
        IocDiscoverySkipReason.CONTRACT_ANNOTATION_DEFAULT_EXPORT
      ) {
        const site = defaultExportContractSite(
          checker,
          sourceFile,
          outcome.exportName,
        );
        if (site !== undefined) {
          defaultExportOffenders.push({
            modulePath: scan.modulePath,
            exportName: outcome.exportName,
            ...site,
          });
        }
        continue;
      }
      if (INVALID_ANNOTATION_SKIP_REASONS.has(outcome.skipReason)) {
        invalidAnnotationOffenders.push({
          modulePath: scan.modulePath,
          exportName: outcome.exportName,
          skipReason: outcome.skipReason,
        });
        continue;
      }
      if (CLASS_HARD_ERROR_SKIP_REASONS.has(outcome.skipReason)) {
        classUnitOffenders.push({
          modulePath: scan.modulePath,
          exportName: outcome.exportName,
          skipReason: outcome.skipReason,
          detail: classOffenderDetail(
            checker,
            sourceFile,
            outcome.exportName,
            outcome.skipReason,
            outcome.contractName,
          ),
        });
      }
    }

    scopeRoots.push(...scan.scopeRoots);

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

  if (
    classUnitOffenders.length > 0 &&
    runOptions?.tolerateInvalidAnnotations !== true
  ) {
    aggregatedErrors.push(formatClassUnitError(classUnitOffenders));
  }

  if (
    scopeRootOffenders.length > 0 &&
    runOptions?.tolerateInvalidAnnotations !== true
  ) {
    aggregatedErrors.push(formatScopeRootArityError(scopeRootOffenders));
  }

  if (
    defaultExportOffenders.length > 0 &&
    runOptions?.tolerateInvalidAnnotations !== true
  ) {
    aggregatedErrors.push(
      formatDefaultExportContractError(defaultExportOffenders, projectRoot),
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
  const unknownDependencyKeyUnits: UnknownDependencyKeysUnit[] = [];
  enrichDependencyContracts(
    program,
    acceptedFactories,
    knownContracts,
    discoveryPaths,
    sourceFileByPath,
    unknownDependencyKeyUnits,
    "registration unit",
  );
  // Stage 2: scope-root units get the same deps enrichment. Stage 1 skipped it because it is a
  // demand/supply analysis; the inferred `dependencyKeys` are what the subtree walk starts from.
  enrichDependencyContracts(
    program,
    scopeRoots,
    knownContracts,
    discoveryPaths,
    sourceFileByPath,
    unknownDependencyKeyUnits,
    "scope-root variant",
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
    scopeRoots,
    unknownDependencyKeyUnits,
  };
};
