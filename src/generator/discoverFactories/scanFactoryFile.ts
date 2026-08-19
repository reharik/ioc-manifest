import path from "node:path";
import ts from "typescript";
import {
  getClassConfig,
  getImplOverrideForImplementation,
} from "../../config/iocConfig.js";
import {
  awilixCamelCase,
  resolveRegistrationKeyForClass,
  resolveRegistrationKeyForFactory,
} from "../../core/resolver.js";
import {
  classImplementsTypes,
  contractSiteImportModuleSpecifier,
  findClassConstructor,
  isAbstractClassDeclaration,
  nearestImplementsBearingAncestor,
  resolveAnnotationContract,
  unwrapReturnTypeAnnotation,
  type AnnotationContractResolution,
  type DeclaredScopeRootSite,
  type DiscoveredUnitDecl,
} from "./contractSite.js";
import {
  IocDiscoverySkipReason,
  IocDiscoveryStatus,
  type IocDiscoveryOutcome,
  type IocDiscoveryStrategy,
} from "./discoveryOutcomeTypes.js";
import {
  computeDiscoveryModulePath,
  computeManifestModuleSpecifier,
} from "../manifestPaths.js";
import type {
  DiscoveredFactory,
  DiscoveredScopeRoot,
  FactoryDiscoveryFileContext,
} from "../types.js";

export { unwrapReturnTypeAnnotation } from "./contractSite.js";

/** Structural facts about a source file, collected in one AST walk. */
export type FileAnalysis = {
  exportedNames: Set<string>;
  localTypes: Set<string>;
  importedIds: Set<string>;
  /** Registration-unit declaration per exported name (factory function or class). */
  unitDeclByExport: Map<string, DiscoveredUnitDecl>;
};

/**
 * A factory's implementation name: the export name past the prefix, camelCased with the one shared
 * rule (see {@link awilixCamelCase}). Keeping this identical to the derived registration key is
 * what lets `registrations[Contract][implementationName]` be looked up by the same string a user
 * sees in the cradle.
 */
const implementationNameFromFactoryExport = (
  exportName: string,
  factoryPrefix: string,
): string | undefined => {
  if (!exportName.startsWith(factoryPrefix)) {
    return undefined;
  }

  const rest = exportName.slice(factoryPrefix.length);
  if (rest.length === 0) {
    return undefined;
  }

  return awilixCamelCase(rest);
};

const relProjectPath = (projectRoot: string, absPath: string): string =>
  path.relative(projectRoot, absPath).replace(/\\/g, "/");

const isExportedNode = (node: ts.Node): boolean => {
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  return !!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
};

const unwrapExpression = (expr: ts.Expression): ts.Expression => {
  if (ts.isParenthesizedExpression(expr)) {
    return unwrapExpression(expr.expression);
  }
  if (ts.isAsExpression(expr)) {
    return unwrapExpression(expr.expression);
  }
  return expr;
};

export const collectFileAnalysisForFactoryDiscovery = (
  sourceFile: ts.SourceFile,
): FileAnalysis => {
  const exportedNames = new Set<string>();
  const localTypes = new Set<string>();
  const importedIds = new Set<string>();
  const unitDeclByExport = new Map<string, DiscoveredUnitDecl>();

  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node) && isExportedNode(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const exportName = decl.name.text;
          exportedNames.add(exportName);

          if (!decl.initializer || unitDeclByExport.has(exportName)) {
            continue;
          }

          const initUnwrapped = unwrapExpression(decl.initializer);
          if (ts.isArrowFunction(initUnwrapped)) {
            unitDeclByExport.set(exportName, {
              unitKind: "factory",
              decl: initUnwrapped,
            });
            continue;
          }
          if (ts.isFunctionExpression(initUnwrapped)) {
            unitDeclByExport.set(exportName, {
              unitKind: "factory",
              decl: initUnwrapped,
            });
            continue;
          }
        }
      }
    }

    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name &&
      isExportedNode(node)
    ) {
      exportedNames.add(node.name.text);
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      isExportedNode(node) &&
      !unitDeclByExport.has(node.name.text)
    ) {
      unitDeclByExport.set(node.name.text, {
        unitKind: "factory",
        decl: node,
      });
    }

    if (
      ts.isClassDeclaration(node) &&
      node.name &&
      isExportedNode(node) &&
      !unitDeclByExport.has(node.name.text)
    ) {
      unitDeclByExport.set(node.name.text, {
        unitKind: "class",
        decl: node,
        implementsTypes: classImplementsTypes(node),
      });
    }

    if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const element of node.exportClause.elements) {
        exportedNames.add(element.name.text);
      }
    }

    if (ts.isInterfaceDeclaration(node) && isExportedNode(node) && node.name) {
      localTypes.add(node.name.text);
    }

    if (ts.isTypeAliasDeclaration(node) && isExportedNode(node)) {
      localTypes.add(node.name.text);
    }

    if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const el of node.exportClause.elements) {
        localTypes.add(el.name.text);
      }
    }

    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause) {
        if (clause.name) {
          importedIds.add(clause.name.text);
        }

        if (clause.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) {
            importedIds.add(clause.namedBindings.name.text);
          } else if (ts.isNamedImports(clause.namedBindings)) {
            for (const el of clause.namedBindings.elements) {
              importedIds.add(el.name.text);
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return {
    exportedNames,
    localTypes,
    importedIds,
    unitDeclByExport,
  };
};

export type ScanFactoryFileResult = {
  modulePath: string;
  outcomes: IocDiscoveryOutcome[];
  discovered: DiscoveredFactory[];
  /**
   * Scope-root units, kept out of {@link discovered} on purpose: at stage 1 they reach no manifest,
   * so they must not enter the contract map or the registration plan.
   */
  scopeRoots: DiscoveredScopeRoot[];
};

const matchesFactoryNaming = (
  exportName: string,
  factoryPrefix: string,
): boolean => {
  const implementationName = implementationNameFromFactoryExport(
    exportName,
    factoryPrefix,
  );
  return implementationName !== undefined && implementationName.length > 0;
};

/**
 * Maps a contract-site resolution failure to its categorized skip reason. Shared by both unit
 * kinds — the identity rule is the same, so its failure taxonomy is too.
 */
const skipReasonForContractResolution = (
  resolution: AnnotationContractResolution,
): IocDiscoverySkipReason | undefined => {
  switch (resolution.kind) {
    case "missing_annotation":
      return IocDiscoverySkipReason.MISSING_RETURN_TYPE_ANNOTATION;
    case "inline_object":
      return IocDiscoverySkipReason.CONTRACT_ANNOTATION_INLINE_OBJECT;
    case "anonymous_union":
      return IocDiscoverySkipReason.CONTRACT_ANNOTATION_ANONYMOUS_UNION;
    case "unsupported":
      return IocDiscoverySkipReason.CONTRACT_NOT_RESOLVED;
    case "unresolved":
      return IocDiscoverySkipReason.CONTRACT_NOT_FOUND;
    case "scope_root_wrong_arity":
      return IocDiscoverySkipReason.SCOPE_ROOT_WRONG_ARITY;
    default:
      return undefined;
  }
};

/**
 * PROXY-mode injection reads dependencies off one destructured object parameter. Anything else on
 * a constructor (several parameters, a rest parameter, or a primitive/array/callable parameter
 * type) cannot be injected and is reported as a hard error rather than silently dropped.
 *
 * Purely syntactic, like contract identity: no checker involved.
 */
const constructorShapeIsInjectable = (
  ctor: ts.ConstructorDeclaration,
): boolean => {
  if (ctor.parameters.length === 0) {
    return true;
  }
  if (ctor.parameters.length > 1) {
    return false;
  }

  const param = ctor.parameters[0]!;
  if (param.dotDotDotToken !== undefined) {
    return false;
  }
  /* Parameter properties (`constructor(private readonly foo: Foo)`) are CLASSIC-mode injection. */
  if ((ts.getModifiers(param) ?? []).length > 0) {
    return false;
  }

  const typeNode = param.type;
  if (typeNode === undefined) {
    /* No annotation: the deps validator downstream produces the actionable message. */
    return true;
  }
  if (
    ts.isArrayTypeNode(typeNode) ||
    ts.isTupleTypeNode(typeNode) ||
    ts.isFunctionTypeNode(typeNode) ||
    ts.isConstructorTypeNode(typeNode) ||
    ts.isLiteralTypeNode(typeNode)
  ) {
    return false;
  }
  switch (typeNode.kind) {
    case ts.SyntaxKind.StringKeyword:
    case ts.SyntaxKind.NumberKeyword:
    case ts.SyntaxKind.BooleanKeyword:
    case ts.SyntaxKind.BigIntKeyword:
    case ts.SyntaxKind.SymbolKeyword:
    case ts.SyntaxKind.VoidKeyword:
    case ts.SyntaxKind.NullKeyword:
    case ts.SyntaxKind.UndefinedKeyword:
    case ts.SyntaxKind.NeverKeyword:
      return false;
    default:
      return true;
  }
};

type AcceptedUnit = {
  exportName: string;
  unitKind: "class" | "factory";
  discoveredBy: IocDiscoveryStrategy;
  implementationName: string;
  registrationKey: string;
  contractName: string;
  declSourceFile: ts.SourceFile;
  contractSite: ts.TypeNode;
  /** Present when the contract site was written `ScopeRoot<TContract, TLbv>`. */
  scopeRoot?: DeclaredScopeRootSite;
};

export const scanFactoryFile = (
  context: FactoryDiscoveryFileContext,
  checker: ts.TypeChecker,
): ScanFactoryFileResult => {
  const {
    absPath,
    sourceFile,
    projectRoot,
    factoryPrefix,
    paths: { scanDirs, generatedDir },
  } = context;

  const modulePath = computeDiscoveryModulePath(absPath, projectRoot, scanDirs);
  const discovered: DiscoveredFactory[] = [];
  const scopeRoots: DiscoveredScopeRoot[] = [];
  const outcomes: IocDiscoveryOutcome[] = [];

  const sourceText = sourceFile.getText();
  // Cheap file-level prefilter: a file with none of the factory prefix, an `implements` clause, or
  // an `extends` clause can hold no registration unit of either kind — and no near-miss either.
  // `extends` earns its place here only for the inherited-contract diagnostic below; it widens the
  // set of files that get an AST walk, which is build-time cost paid for a silent-drop warning.
  const shouldScan =
    sourceText.includes(factoryPrefix) ||
    sourceText.includes("implements") ||
    sourceText.includes("extends");
  if (!shouldScan) {
    outcomes.push({
      scope: "file",
      status: IocDiscoveryStatus.SKIPPED,
      skipReason: IocDiscoverySkipReason.NO_FACTORY_PATTERN_IN_SOURCE,
    });
    return { modulePath, outcomes, discovered, scopeRoots };
  }

  const analysis = collectFileAnalysisForFactoryDiscovery(sourceFile);

  const isContractInScope = (contract: string): boolean =>
    analysis.localTypes.has(contract) || analysis.importedIds.has(contract);

  const fileLabel = relProjectPath(projectRoot, absPath);

  /**
   * Trigger conventions, one per unit kind:
   * - factory: exported name starting with the configured prefix
   * - class:   exported class carrying an `implements` clause
   *
   * A class without `implements` is ordinary code, not a failed registration — it produces no
   * outcome at all.
   */
  const candidateExports = Array.from(analysis.exportedNames)
    .sort((a, b) => a.localeCompare(b))
    .filter((exportName) => {
      const unit = analysis.unitDeclByExport.get(exportName);
      if (unit?.unitKind === "class") {
        return unit.implementsTypes.length > 0;
      }
      return matchesFactoryNaming(exportName, factoryPrefix);
    });

  /**
   * Near-misses are collected separately from candidates, because they are not candidates: nothing
   * here can ever register. A concrete class that inherits a contract but restates no `implements`
   * is reported so the silent drop is visible — see {@link nearestImplementsBearingAncestor} for
   * why inheriting a contract deliberately does not inherit registration.
   */
  for (const [exportName, unit] of [...analysis.unitDeclByExport].sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    if (
      unit.unitKind !== "class" ||
      unit.implementsTypes.length > 0 ||
      isAbstractClassDeclaration(unit.decl)
    ) {
      continue;
    }
    const inherited = nearestImplementsBearingAncestor(checker, unit.decl);
    if (inherited === undefined) {
      continue;
    }
    outcomes.push({
      scope: "export",
      exportName,
      status: IocDiscoveryStatus.SKIPPED,
      skipReason: IocDiscoverySkipReason.CLASS_INHERITED_CONTRACT_NOT_DECLARED,
      contractName: inherited.contractName,
      baseClassName: inherited.ancestorClassName,
    });
  }

  if (candidateExports.length === 0) {
    if (outcomes.length === 0) {
      outcomes.push({
        scope: "file",
        status: IocDiscoveryStatus.SKIPPED,
        skipReason: IocDiscoverySkipReason.NO_MATCHING_EXPORT,
      });
    }
    return { modulePath, outcomes, discovered, scopeRoots };
  }

  const skip = (
    exportName: string,
    skipReason: IocDiscoverySkipReason,
    contractName?: string,
  ): void => {
    outcomes.push({
      scope: "export",
      exportName,
      status: IocDiscoveryStatus.SKIPPED,
      skipReason,
      ...(contractName !== undefined ? { contractName } : {}),
    });
  };

  for (const exportName of candidateExports) {
    const unit = analysis.unitDeclByExport.get(exportName);

    if (unit === undefined) {
      skip(exportName, IocDiscoverySkipReason.INVALID_FACTORY_SIGNATURE);
      continue;
    }

    const accepted =
      unit.unitKind === "class"
        ? acceptClassUnit({
            exportName,
            unit,
            checker,
            context,
            fileLabel,
            skip,
          })
        : acceptFactoryUnit({
            exportName,
            unit,
            checker,
            factoryPrefix,
            context,
            fileLabel,
            skip,
          });

    if (accepted === undefined) {
      continue;
    }

    // The written name (not the declared name) must be locally declared or imported: this keeps
    // globals/lib types undiscoverable and makes aliased imports work naturally.
    if (!isContractInScope(accepted.writtenName)) {
      skip(
        exportName,
        IocDiscoverySkipReason.CONTRACT_NOT_IMPORTED,
        accepted.unit.contractName,
      );
      continue;
    }

    const { unit: row } = accepted;

    const contractTypeRelImport = computeManifestModuleSpecifier(
      row.declSourceFile.fileName,
      generatedDir,
      scanDirs,
      {
        preferredModuleSpecifier: contractSiteImportModuleSpecifier(
          checker,
          row.contractSite,
          sourceFile,
        ),
        projectRoot: context.projectRoot,
      },
    );

    const relImport = computeManifestModuleSpecifier(
      absPath,
      generatedDir,
      scanDirs,
      { projectRoot: context.projectRoot },
    );

    // A scope root branches here and nowhere else: identity, the contract-type import specifier and
    // the derived names were all produced by the paths above, unchanged. What differs is only where
    // the row lands — a separate collection that reaches no manifest at stage 1.
    if (row.scopeRoot !== undefined) {
      scopeRoots.push({
        isScopeRoot: true,
        contractName: row.contractName,
        contractDeclAbsPath: path.normalize(row.declSourceFile.fileName),
        variantName: row.implementationName,
        exportName: row.exportName,
        modulePath,
        relImport,
        unitKind: row.unitKind,
        lbvTypeNode: row.scopeRoot.lbvTypeNode,
        lbvTypeText: row.scopeRoot.lbvTypeText,
        lifetime: "scoped",
      });

      outcomes.push({
        scope: "export",
        exportName: row.exportName,
        status: IocDiscoveryStatus.DISCOVERED,
        contractName: row.contractName,
        implementationName: row.implementationName,
        registrationKey: row.registrationKey,
        discoveredBy: row.discoveredBy,
        isScopeRoot: true,
        declaredLbv: row.scopeRoot.lbvTypeText,
      });
      continue;
    }

    discovered.push({
      unitKind: row.unitKind,
      contractName: row.contractName,
      contractDeclAbsPath: path.normalize(row.declSourceFile.fileName),
      contractTypeRelImport,
      implementationName: row.implementationName,
      exportName: row.exportName,
      registrationKey: row.registrationKey,
      modulePath,
      relImport,
      discoveredBy: row.discoveredBy,
    });

    outcomes.push({
      scope: "export",
      exportName: row.exportName,
      status: IocDiscoveryStatus.DISCOVERED,
      contractName: row.contractName,
      implementationName: row.implementationName,
      registrationKey: row.registrationKey,
      discoveredBy: row.discoveredBy,
    });
  }

  return { modulePath, outcomes, discovered, scopeRoots };
};

type SkipFn = (
  exportName: string,
  skipReason: IocDiscoverySkipReason,
  contractName?: string,
) => void;

type AcceptResult = { unit: AcceptedUnit; writtenName: string } | undefined;

const acceptFactoryUnit = (args: {
  exportName: string;
  unit: Extract<DiscoveredUnitDecl, { unitKind: "factory" }>;
  checker: ts.TypeChecker;
  factoryPrefix: string;
  context: FactoryDiscoveryFileContext;
  fileLabel: string;
  skip: SkipFn;
}): AcceptResult => {
  const { exportName, unit, checker, factoryPrefix, context, fileLabel, skip } =
    args;

  const implementationName = implementationNameFromFactoryExport(
    exportName,
    factoryPrefix,
  );
  if (implementationName === undefined || implementationName.length === 0) {
    return undefined;
  }

  const resolution = resolveAnnotationContract(checker, unit.decl.type);
  if (resolution.kind !== "resolved") {
    const reason = skipReasonForContractResolution(resolution);
    if (reason !== undefined) {
      skip(
        exportName,
        reason,
        resolution.kind === "unresolved" ? resolution.writtenName : undefined,
      );
    }
    return undefined;
  }

  const configRegistrationName = getImplOverrideForImplementation(
    context.iocConfig?.registrations?.[resolution.contractName],
    implementationName,
  )?.name;

  let registrationKey: string;
  try {
    registrationKey = resolveRegistrationKeyForFactory(
      exportName,
      configRegistrationName,
      resolution.contractName,
      { modulePath: fileLabel, contractName: resolution.contractName, exportName },
      factoryPrefix,
    );
  } catch {
    skip(
      exportName,
      IocDiscoverySkipReason.UNSUPPORTED_PATTERN,
      resolution.contractName,
    );
    return undefined;
  }

  return {
    writtenName: resolution.writtenName,
    unit: {
      exportName,
      unitKind: "factory",
      discoveredBy: "naming",
      implementationName,
      registrationKey,
      contractName: resolution.contractName,
      declSourceFile: resolution.declSourceFile,
      contractSite: unwrapReturnTypeAnnotation(unit.decl.type!),
      ...(resolution.scopeRoot !== undefined
        ? { scopeRoot: resolution.scopeRoot }
        : {}),
    },
  };
};

const acceptClassUnit = (args: {
  exportName: string;
  unit: Extract<DiscoveredUnitDecl, { unitKind: "class" }>;
  checker: ts.TypeChecker;
  context: FactoryDiscoveryFileContext;
  fileLabel: string;
  skip: SkipFn;
}): AcceptResult => {
  const { exportName, unit, checker, context, fileLabel, skip } = args;

  // An abstract class carrying `implements` is the normal shared-base pattern, not a registration
  // unit. Skip it, recording the contract it declares: whether that skip is worth warning about
  // depends on whether anything concrete registers the same contract, which only the aggregated
  // reporting layer can see.
  if (isAbstractClassDeclaration(unit.decl)) {
    const declared =
      unit.implementsTypes.length === 1
        ? resolveAnnotationContract(checker, unit.implementsTypes[0]!)
        : undefined;
    skip(
      exportName,
      IocDiscoverySkipReason.CLASS_ABSTRACT,
      declared?.kind === "resolved" ? declared.contractName : undefined,
    );
    return undefined;
  }

  const classConfig = getClassConfig(context.iocConfig, exportName);
  const contractSite = selectClassContractSite(
    checker,
    unit.implementsTypes,
    classConfig?.contract,
  );

  if (contractSite === "ambiguous") {
    skip(exportName, IocDiscoverySkipReason.CLASS_MULTIPLE_IMPLEMENTS);
    return undefined;
  }
  if (contractSite === "configured_contract_not_implemented") {
    skip(
      exportName,
      IocDiscoverySkipReason.CLASS_CONFIGURED_CONTRACT_NOT_IMPLEMENTED,
      classConfig?.contract,
    );
    return undefined;
  }

  const ctor = findClassConstructor(unit.decl);
  if (ctor !== undefined && !constructorShapeIsInjectable(ctor)) {
    skip(exportName, IocDiscoverySkipReason.CLASS_INVALID_CONSTRUCTOR_SHAPE);
    return undefined;
  }

  const resolution = resolveAnnotationContract(checker, contractSite);
  if (resolution.kind !== "resolved") {
    const reason = skipReasonForContractResolution(resolution);
    if (reason !== undefined) {
      skip(
        exportName,
        reason,
        resolution.kind === "unresolved" ? resolution.writtenName : undefined,
      );
    }
    return undefined;
  }

  const implementationName = keyFromClassNameSafe(exportName);
  const configRegistrationName = getImplOverrideForImplementation(
    context.iocConfig?.registrations?.[resolution.contractName],
    implementationName,
  )?.name;

  let registrationKey: string;
  try {
    registrationKey = resolveRegistrationKeyForClass(
      exportName,
      configRegistrationName,
      resolution.contractName,
      { modulePath: fileLabel, contractName: resolution.contractName, exportName },
    );
  } catch {
    skip(
      exportName,
      IocDiscoverySkipReason.UNSUPPORTED_PATTERN,
      resolution.contractName,
    );
    return undefined;
  }

  if (implementationName.length === 0) {
    skip(
      exportName,
      IocDiscoverySkipReason.UNSUPPORTED_PATTERN,
      resolution.contractName,
    );
    return undefined;
  }

  return {
    writtenName: resolution.writtenName,
    unit: {
      exportName,
      unitKind: "class",
      discoveredBy: "implements",
      implementationName,
      registrationKey,
      contractName: resolution.contractName,
      declSourceFile: resolution.declSourceFile,
      contractSite,
    },
  };
};

/** camelCase class name used as the implementation id (never throws; emptiness handled by caller). */
const keyFromClassNameSafe = (className: string): string => {
  try {
    return resolveRegistrationKeyForClass(className, undefined, "", {
      modulePath: "",
      contractName: "",
      exportName: className,
    });
  } catch {
    return "";
  }
};

/**
 * Picks the single `implements` entry that is this class's contract.
 *
 * One entry: that entry. Several: `classes[Class].contract` must name one of them — otherwise the
 * class is ambiguous and discovery reports a hard error naming both contracts.
 */
const selectClassContractSite = (
  checker: ts.TypeChecker,
  implementsTypes: readonly ts.ExpressionWithTypeArguments[],
  configuredContract: string | undefined,
):
  | ts.ExpressionWithTypeArguments
  | "ambiguous"
  | "configured_contract_not_implemented" => {
  if (implementsTypes.length === 1) {
    if (configuredContract === undefined) {
      return implementsTypes[0]!;
    }
    const resolution = resolveAnnotationContract(checker, implementsTypes[0]!);
    const matches =
      resolution.kind === "resolved" &&
      (resolution.contractName === configuredContract ||
        resolution.writtenName === configuredContract);
    return matches
      ? implementsTypes[0]!
      : "configured_contract_not_implemented";
  }

  if (configuredContract === undefined) {
    return "ambiguous";
  }

  const selected = implementsTypes.find((candidate) => {
    const resolution = resolveAnnotationContract(checker, candidate);
    return (
      resolution.kind === "resolved" &&
      (resolution.contractName === configuredContract ||
        resolution.writtenName === configuredContract)
    );
  });

  return selected ?? "configured_contract_not_implemented";
};

/**
 * Contract names written in a class's `implements` clause, for error messages. Falls back to the
 * source text when a name will not resolve.
 */
export const classImplementsContractNames = (
  checker: ts.TypeChecker,
  classDecl: ts.ClassDeclaration,
): readonly string[] =>
  classImplementsTypes(classDecl).map((candidate) => {
    const resolution = resolveAnnotationContract(checker, candidate);
    if (resolution.kind === "resolved") {
      return resolution.contractName;
    }
    if (resolution.kind === "unresolved") {
      return resolution.writtenName;
    }
    return candidate.getText();
  });
