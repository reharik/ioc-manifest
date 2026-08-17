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

/**
 * Syntactically unwraps a factory return annotation to the contract reference: strips
 * parentheses and `Promise<T>` wrappers (by written name, no checker). The result is what the
 * author wrote — type-level aliases are never followed.
 */
export const unwrapReturnTypeAnnotation = (node: ts.TypeNode): ts.TypeNode => {
  if (ts.isParenthesizedTypeNode(node)) {
    return unwrapReturnTypeAnnotation(node.type);
  }
  if (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === "Promise" &&
    node.typeArguments !== undefined &&
    node.typeArguments.length > 0
  ) {
    return unwrapReturnTypeAnnotation(node.typeArguments[0]);
  }
  return node;
};

const leftmostIdentifier = (name: ts.EntityName): ts.Identifier =>
  ts.isQualifiedName(name) ? leftmostIdentifier(name.left) : name;

/**
 * Contract identity resolved from a factory's written return type annotation.
 *
 * Identity is syntactic: the annotation must be a single named type reference (possibly with
 * type arguments) after unwrapping `Promise<T>` and parentheses. Import aliases are followed
 * (an aliased import names the same declaration; the contract name is the declared name), but
 * type-level aliases are NOT — `type QueueTask = WorkerTaskBase` used as an annotation is the
 * distinct contract `QueueTask`.
 */
type AnnotationContractResolution =
  | {
      kind: "resolved";
      /** Declared exported name at the declaration site (import aliases unwrapped). */
      contractName: string;
      /** Leftmost identifier as written in the factory file (for the local-scope check). */
      writtenName: string;
      declSourceFile: ts.SourceFile;
    }
  | { kind: "missing_annotation" }
  | { kind: "inline_object" }
  | { kind: "anonymous_union" }
  /** Keyword/array/inline-intersection/other non-reference forms — skipped, not hard errors. */
  | { kind: "unsupported" }
  | { kind: "unresolved"; writtenName: string };

/**
 * Resolves the annotation's type reference to its declaration.
 *
 * The checker is used ONLY as a declaration locator (`getSymbolAtLocation` on the written name,
 * plus `getAliasedSymbol` to unwrap import aliases). No type normalization
 * (`getApparentType` / `getReturnTypeOfSignature`) participates in identity.
 */
const resolveAnnotationContract = (
  checker: ts.TypeChecker,
  factoryDecl: ts.FunctionLike,
): AnnotationContractResolution => {
  const annotation = factoryDecl.type;
  if (annotation === undefined) {
    return { kind: "missing_annotation" };
  }

  const unwrapped = unwrapReturnTypeAnnotation(annotation);

  if (ts.isTypeLiteralNode(unwrapped)) {
    return { kind: "inline_object" };
  }
  if (ts.isUnionTypeNode(unwrapped)) {
    return { kind: "anonymous_union" };
  }
  if (!ts.isTypeReferenceNode(unwrapped)) {
    return { kind: "unsupported" };
  }

  const writtenName = leftmostIdentifier(unwrapped.typeName).text;

  let symbol = checker.getSymbolAtLocation(unwrapped.typeName);
  if (symbol === undefined) {
    return { kind: "unresolved", writtenName };
  }

  while ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    const aliased = checker.getAliasedSymbol(symbol);
    if (aliased === symbol) {
      break;
    }
    symbol = aliased;
  }

  const decl = symbol.declarations?.[0];
  if (decl === undefined) {
    return { kind: "unresolved", writtenName };
  }
  if (ts.isTypeParameterDeclaration(decl)) {
    return { kind: "unsupported" };
  }

  return {
    kind: "resolved",
    contractName: symbol.getName(),
    writtenName,
    declSourceFile: decl.getSourceFile(),
  };
};

/**
 * Module specifier the factory file already uses to import the annotation's written name, read
 * from the import declaration AST. Consumed by {@link computeManifestModuleSpecifier}, which only
 * honors it when it is a bare package specifier.
 */
const annotationImportModuleSpecifier = (
  checker: ts.TypeChecker,
  annotationTypeName: ts.EntityName,
  factorySourceFile: ts.SourceFile,
): string | undefined => {
  const local = checker.getSymbolAtLocation(
    leftmostIdentifier(annotationTypeName),
  );
  if (local === undefined) {
    return undefined;
  }
  for (const decl of local.declarations ?? []) {
    if (decl.getSourceFile() !== factorySourceFile) {
      continue;
    }
    let node: ts.Node | undefined = decl;
    while (node !== undefined) {
      if (ts.isImportDeclaration(node)) {
        return ts.isStringLiteralLike(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : undefined;
      }
      node = node.parent;
    }
  }
  return undefined;
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

    const resolution = resolveAnnotationContract(checker, factoryDecl);

    if (resolution.kind === "missing_annotation") {
      outcomes.push({
        scope: "export",
        exportName,
        status: IocDiscoveryStatus.SKIPPED,
        skipReason: IocDiscoverySkipReason.MISSING_RETURN_TYPE_ANNOTATION,
      });
      continue;
    }
    if (resolution.kind === "inline_object") {
      outcomes.push({
        scope: "export",
        exportName,
        status: IocDiscoveryStatus.SKIPPED,
        skipReason: IocDiscoverySkipReason.CONTRACT_ANNOTATION_INLINE_OBJECT,
      });
      continue;
    }
    if (resolution.kind === "anonymous_union") {
      outcomes.push({
        scope: "export",
        exportName,
        status: IocDiscoveryStatus.SKIPPED,
        skipReason: IocDiscoverySkipReason.CONTRACT_ANNOTATION_ANONYMOUS_UNION,
      });
      continue;
    }
    if (resolution.kind === "unsupported") {
      outcomes.push({
        scope: "export",
        exportName,
        status: IocDiscoveryStatus.SKIPPED,
        skipReason: IocDiscoverySkipReason.CONTRACT_NOT_RESOLVED,
      });
      continue;
    }
    if (resolution.kind === "unresolved") {
      outcomes.push({
        scope: "export",
        exportName,
        status: IocDiscoveryStatus.SKIPPED,
        skipReason: IocDiscoverySkipReason.CONTRACT_NOT_FOUND,
        contractName: resolution.writtenName,
      });
      continue;
    }

    const { contractName, writtenName, declSourceFile } = resolution;

    // The written name (not the declared name) must be locally declared or imported: this keeps
    // globals/lib types undiscoverable and makes aliased imports work naturally.
    if (!isContractInScope(writtenName)) {
      outcomes.push({
        scope: "export",
        exportName,
        status: IocDiscoveryStatus.SKIPPED,
        skipReason: IocDiscoverySkipReason.CONTRACT_NOT_IMPORTED,
        contractName,
      });
      continue;
    }

    const annotationTypeNode = unwrapReturnTypeAnnotation(factoryDecl.type!);
    const contractTypeRelImport = computeManifestModuleSpecifier(
      declSourceFile.fileName,
      generatedDir,
      scanDirs,
      {
        preferredModuleSpecifier: ts.isTypeReferenceNode(annotationTypeNode)
          ? annotationImportModuleSpecifier(
              checker,
              annotationTypeNode.typeName,
              sourceFile,
            )
          : undefined,
        projectRoot: context.projectRoot,
      },
    );

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
        factoryPrefix,
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
      contractDeclAbsPath: path.normalize(declSourceFile.fileName),
      contractTypeRelImport,
      implementationName,
      exportName,
      registrationKey,
      modulePath,
      relImport: computeManifestModuleSpecifier(absPath, generatedDir, scanDirs, {
        projectRoot: context.projectRoot,
      }),
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
