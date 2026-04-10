import path from "node:path";
import ts from "typescript";
import { getImplOverrideForImplementation } from "../../config/iocConfig.js";
import { resolveRegistrationKeyForFactory } from "../../core/resolver.js";
import {
  IocDiscoverySkipReason,
  IocDiscoveryStatus,
  type IocDiscoveryOutcome,
} from "./discoveryOutcomeTypes.js";
import {
  computeDiscoveryModulePath,
  computeManifestModuleSpecifier,
} from "../manifestPaths.js";
import type {
  DiscoveredFactory,
  FactoryDiscoveryFileContext,
} from "../types.js";

/** Structural facts about a source file, collected in one AST walk. */
export type FileAnalysis = {
  exportedNames: Set<string>;
  localTypes: Set<string>;
  importedIds: Set<string>;
  factoryDeclByExport: Map<string, ts.FunctionLike>;
};

const intrinsicNames = new Set([
  "string",
  "number",
  "boolean",
  "void",
  "undefined",
  "null",
  "never",
  "unknown",
  "any",
  "bigint",
  "symbol",
]);

const unwrapPromiseType = (checker: ts.TypeChecker, t: ts.Type): ts.Type => {
  const sym = t.getSymbol();
  const symName = sym?.getName();
  if (symName === "Promise") {
    const args = checker.getTypeArguments(t as ts.TypeReference);
    if (args.length > 0) {
      return unwrapPromiseType(checker, args[0]);
    }
  }
  return t;
};

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

  return rest.charAt(0).toLowerCase() + rest.slice(1);
};

const contractNameFromReturnType = (
  checker: ts.TypeChecker,
  returnType: ts.Type,
): string | undefined => {
  const t0 = unwrapPromiseType(checker, returnType);
  const t = checker.getApparentType(t0);

  if (t.isUnion()) {
    return undefined;
  }

  const symbol = t.aliasSymbol ?? t.getSymbol();
  if (!symbol) {
    return undefined;
  }

  const name = symbol.getName();
  if (!name || intrinsicNames.has(name)) {
    return undefined;
  }

  return name;
};

/**
 * Source file where the contract type symbol is declared (follows aliases/imports via the checker).
 */
const getContractTypeDeclarationSourceFile = (
  checker: ts.TypeChecker,
  returnType: ts.Type,
): ts.SourceFile | undefined => {
  const t0 = unwrapPromiseType(checker, returnType);
  const t = checker.getApparentType(t0);

  if (t.isUnion()) {
    return undefined;
  }

  let symbol = t.aliasSymbol ?? t.getSymbol();
  if (!symbol) {
    return undefined;
  }

  if (symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }

  const decl = symbol.declarations?.[0];
  if (!decl) {
    return undefined;
  }

  return decl.getSourceFile();
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
  const factoryDeclByExport = new Map<string, ts.FunctionLike>();

  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node) && isExportedNode(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const exportName = decl.name.text;
          exportedNames.add(exportName);

          if (!decl.initializer || factoryDeclByExport.has(exportName)) {
            continue;
          }

          const initUnwrapped = unwrapExpression(decl.initializer);
          if (ts.isArrowFunction(initUnwrapped)) {
            factoryDeclByExport.set(exportName, initUnwrapped);
            continue;
          }
          if (ts.isFunctionExpression(initUnwrapped)) {
            factoryDeclByExport.set(exportName, initUnwrapped);
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
      !factoryDeclByExport.has(node.name.text)
    ) {
      factoryDeclByExport.set(node.name.text, node);
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
    factoryDeclByExport,
  };
};

export type ScanFactoryFileResult = {
  modulePath: string;
  outcomes: IocDiscoveryOutcome[];
  discovered: DiscoveredFactory[];
};

type DiscoveryMatch = {
  matchedBy: "naming";
  implementationName: string;
};

const matchFactoryExport = (
  exportName: string,
  factoryPrefix: string,
): DiscoveryMatch | undefined => {
  const implementationName = implementationNameFromFactoryExport(
    exportName,
    factoryPrefix,
  );

  if (!implementationName || implementationName.length === 0) {
    return undefined;
  }

  return {
    matchedBy: "naming",
    implementationName,
  };
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
    iocConfig,
    paths: { scanDirs, generatedDir },
  } = context;

  const modulePath = computeDiscoveryModulePath(
    absPath,
    projectRoot,
    scanDirs,
  );
  const discovered: DiscoveredFactory[] = [];
  const outcomes: IocDiscoveryOutcome[] = [];

  const sourceText = sourceFile.getText();
  const shouldScan = sourceText.includes(factoryPrefix);
  if (!shouldScan) {
    outcomes.push({
      scope: "file",
      status: IocDiscoveryStatus.SKIPPED,
      skipReason: IocDiscoverySkipReason.NO_FACTORY_PATTERN_IN_SOURCE,
    });
    return { modulePath, outcomes, discovered };
  }

  const analysis = collectFileAnalysisForFactoryDiscovery(sourceFile);

  const isContractInScope = (contract: string): boolean =>
    analysis.localTypes.has(contract) || analysis.importedIds.has(contract);

  const fileLabel = relProjectPath(projectRoot, absPath);

  const candidateExports = Array.from(analysis.exportedNames)
    .sort((a, b) => a.localeCompare(b))
    .filter(
      (exportName) =>
        matchFactoryExport(exportName, factoryPrefix) !== undefined,
    );

  if (candidateExports.length === 0) {
    outcomes.push({
      scope: "file",
      status: IocDiscoveryStatus.SKIPPED,
      skipReason: IocDiscoverySkipReason.NO_MATCHING_EXPORT,
    });
    return { modulePath, outcomes, discovered };
  }

  for (const exportName of candidateExports) {
    const match = matchFactoryExport(exportName, factoryPrefix);
    if (!match) {
      continue;
    }

    const implementationName = match.implementationName;
    const factoryDecl = analysis.factoryDeclByExport.get(exportName);
    if (!factoryDecl) {
      outcomes.push({
        scope: "export",
        exportName,
        status: IocDiscoveryStatus.SKIPPED,
        skipReason: IocDiscoverySkipReason.INVALID_FACTORY_SIGNATURE,
      });
      continue;
    }

    const signature = checker.getSignatureFromDeclaration(factoryDecl);
    if (!signature) {
      outcomes.push({
        scope: "export",
        exportName,
        status: IocDiscoveryStatus.SKIPPED,
        skipReason: IocDiscoverySkipReason.INVALID_FACTORY_SIGNATURE,
      });
      continue;
    }

    const returnType = checker.getReturnTypeOfSignature(signature);
    const contractName = contractNameFromReturnType(checker, returnType);

    if (!contractName) {
      outcomes.push({
        scope: "export",
        exportName,
        status: IocDiscoveryStatus.SKIPPED,
        skipReason: IocDiscoverySkipReason.CONTRACT_NOT_RESOLVED,
      });
      continue;
    }

    const contractDeclSource = getContractTypeDeclarationSourceFile(
      checker,
      returnType,
    );
    if (!contractDeclSource) {
      outcomes.push({
        scope: "export",
        exportName,
        status: IocDiscoveryStatus.SKIPPED,
        skipReason: IocDiscoverySkipReason.CONTRACT_NOT_FOUND,
        contractName,
      });
      continue;
    }

    const contractTypeRelImport = computeManifestModuleSpecifier(
      contractDeclSource.fileName,
      generatedDir,
      scanDirs,
    );

    if (!isContractInScope(contractName)) {
      outcomes.push({
        scope: "export",
        exportName,
        status: IocDiscoveryStatus.SKIPPED,
        skipReason: IocDiscoverySkipReason.CONTRACT_NOT_IMPORTED,
        contractName,
      });
      continue;
    }

    const configRegistrationName = getImplOverrideForImplementation(
      iocConfig?.registrations?.[contractName],
      implementationName,
    )?.name;

    let registrationKey: string;
    try {
      registrationKey = resolveRegistrationKeyForFactory(
        exportName,
        configRegistrationName,
        contractName,
        {
          modulePath: fileLabel,
          contractName,
          exportName,
        },
      );
    } catch {
      outcomes.push({
        scope: "export",
        exportName,
        status: IocDiscoveryStatus.SKIPPED,
        skipReason: IocDiscoverySkipReason.UNSUPPORTED_PATTERN,
        contractName,
      });
      continue;
    }

    discovered.push({
      contractName,
      contractTypeRelImport,
      implementationName,
      exportName,
      registrationKey,
      modulePath,
      relImport: computeManifestModuleSpecifier(absPath, generatedDir, scanDirs),
      discoveredBy: match.matchedBy,
    });

    outcomes.push({
      scope: "export",
      exportName,
      status: IocDiscoveryStatus.DISCOVERED,
      contractName,
      implementationName,
      registrationKey,
      discoveredBy: match.matchedBy,
    });
  }

  return { modulePath, outcomes, discovered };
};
