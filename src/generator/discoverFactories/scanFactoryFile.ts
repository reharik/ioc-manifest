import path from "node:path";
import ts from "typescript";
import {
  keyFromExportName,
  resolveRegistrationKeyForFactory,
} from "../../core/resolver.js";
import type { DiscoveredFactory, FactoryDiscoveryFileContext } from "../types.js";

/** Structural facts about a source file, collected in one AST walk. */
export type FileAnalysis = {
  exportedNames: Set<string>;
  injectableWrappedExports: Set<string>;
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

const toPosix = (value: string): string => value.replace(/\\/g, "/");

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

const modulePathFromSrc = (absFile: string, srcDir: string): string =>
  toPosix(path.relative(srcDir, absFile));

const relProjectPath = (projectRoot: string, absPath: string): string =>
  path.relative(projectRoot, absPath).replace(/\\/g, "/");

const relImportFromGeneratedDir = (
  absFile: string,
  generatedDir: string,
): string => {
  let rel = path.relative(generatedDir, absFile);
  rel = toPosix(rel).replace(/\.[^.]+$/, "");
  if (!rel.startsWith(".")) rel = "./" + rel;
  return `${rel}.js`;
};

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

const isInjectableCallExpression = (expr: ts.Expression): boolean => {
  const unwrapped = unwrapExpression(expr);
  return (
    ts.isCallExpression(unwrapped) &&
    ts.isIdentifier(unwrapped.expression) &&
    unwrapped.expression.text === "injectable"
  );
};

const getInjectableWrappedFactoryDecl = (
  expr: ts.Expression,
): ts.FunctionLike | undefined => {
  const unwrapped = unwrapExpression(expr);
  if (!isInjectableCallExpression(unwrapped)) {
    return undefined;
  }
  if (!ts.isCallExpression(unwrapped)) {
    return undefined;
  }
  const arg0 = unwrapped.arguments[0];
  if (!arg0) {
    return undefined;
  }
  const inner = unwrapExpression(arg0);
  if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) {
    return inner;
  }
  return undefined;
};

const collectFileAnalysis = (sourceFile: ts.SourceFile): FileAnalysis => {
  const exportedNames = new Set<string>();
  const injectableWrappedExports = new Set<string>();
  const localTypes = new Set<string>();
  const importedIds = new Set<string>();
  const factoryDeclByExport = new Map<string, ts.FunctionLike>();

  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node) && isExportedNode(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const exportName = decl.name.text;
          exportedNames.add(exportName);
          if (!decl.initializer || factoryDeclByExport.has(exportName)) continue;

          const initUnwrapped = unwrapExpression(decl.initializer);
          if (ts.isArrowFunction(initUnwrapped)) {
            factoryDeclByExport.set(exportName, initUnwrapped);
            continue;
          }
          if (ts.isFunctionExpression(initUnwrapped)) {
            factoryDeclByExport.set(exportName, initUnwrapped);
            continue;
          }

          const wrappedFactoryDecl = getInjectableWrappedFactoryDecl(
            decl.initializer,
          );
          if (wrappedFactoryDecl) {
            factoryDeclByExport.set(exportName, wrappedFactoryDecl);
            injectableWrappedExports.add(exportName);
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
    injectableWrappedExports,
    localTypes,
    importedIds,
    factoryDeclByExport,
  };
};

export const scanFactoryFile = (
  context: FactoryDiscoveryFileContext,
  checker: ts.TypeChecker,
): DiscoveredFactory[] => {
  const {
    absPath,
    sourceFile,
    projectRoot,
    factoryPrefix,
    iocConfig,
    paths: { srcDir, generatedDir },
  } = context;

  const out: DiscoveredFactory[] = [];
  const sourceText = sourceFile.getText();
  const shouldScan =
    sourceText.includes(factoryPrefix) || sourceText.includes("injectable(");
  if (!shouldScan) return out;

  const analysis = collectFileAnalysis(sourceFile);

  const isContractInScope = (contract: string): boolean =>
    analysis.localTypes.has(contract) || analysis.importedIds.has(contract);

  const fileLabel = relProjectPath(projectRoot, absPath);

  type DiscoveryMatch = {
    matchedBy: "naming" | "injectable-wrapper";
    implementationName: string;
  };

  const discoveryMatchers: Array<{
    matchedBy: DiscoveryMatch["matchedBy"];
    matchImplementationName: (exportName: string) => string | undefined;
  }> = [
    {
      matchedBy: "naming",
      matchImplementationName: (exportName: string) =>
        implementationNameFromFactoryExport(exportName, factoryPrefix),
    },
    {
      matchedBy: "injectable-wrapper",
      matchImplementationName: (exportName: string) =>
        analysis.injectableWrappedExports.has(exportName)
          ? keyFromExportName(exportName)
          : undefined,
    },
  ];

  const matchInjectableExport = (
    exportName: string,
  ): DiscoveryMatch | undefined => {
    for (const matcher of discoveryMatchers) {
      const implementationName = matcher.matchImplementationName(exportName);
      if (implementationName !== undefined && implementationName.length > 0) {
        return { matchedBy: matcher.matchedBy, implementationName };
      }
    }
    return undefined;
  };

  for (const exportName of analysis.exportedNames) {
    const match = matchInjectableExport(exportName);
    if (!match) continue;

    const implementationName = match.implementationName;
    if (!implementationName || implementationName.length === 0) {
      throw new Error(
        `[ioc] ${fileLabel}: export "${exportName}" is injectable but an implementation name could not be derived.`,
      );
    }

    const factoryDecl = analysis.factoryDeclByExport.get(exportName);
    if (!factoryDecl) {
      throw new Error(
        `[ioc] ${fileLabel}: export "${exportName}" is injectable but the export is not a function factory. Use an exported function declaration or a const with a function/arrow initializer (optionally wrapped with injectable(...)).`,
      );
    }

    const signature = checker.getSignatureFromDeclaration(factoryDecl);
    if (!signature) {
      throw new Error(
        `[ioc] ${fileLabel}: export "${exportName}" — no call signature (cannot read return type).`,
      );
    }

    const returnType = checker.getReturnTypeOfSignature(signature);
    const contractName = contractNameFromReturnType(checker, returnType);

    if (!contractName) {
      throw new Error(
        `[ioc] ${fileLabel}: export "${exportName}" — return type must be a single named interface, class, or type alias (not a union, inline object type, or intrinsic). Refactor the return type or add an explicit named contract type.`,
      );
    }

    const contractDeclSource = getContractTypeDeclarationSourceFile(
      checker,
      returnType,
    );
    if (!contractDeclSource) {
      throw new Error(
        `[ioc] ${fileLabel}: export "${exportName}" — could not resolve a declaration source file for contract type "${contractName}".`,
      );
    }

    const contractTypeRelImport = relImportFromGeneratedDir(
      contractDeclSource.fileName,
      generatedDir,
    );

    if (!isContractInScope(contractName)) {
      throw new Error(
        `[ioc] ${fileLabel}: export "${exportName}" returns "${contractName}" but that type is not in scope (export it from this file or import it). The checker needs the contract symbol available here.`,
      );
    }

    const configRegistrationName =
      iocConfig?.registrations?.[contractName]?.[implementationName]?.name;
    const registrationKey = resolveRegistrationKeyForFactory(
      exportName,
      configRegistrationName,
      contractName,
      {
        modulePath: fileLabel,
        contractName,
        exportName,
      },
    );

    out.push({
      contractName,
      contractTypeRelImport,
      implementationName,
      exportName,
      registrationKey,
      modulePath: modulePathFromSrc(absPath, srcDir),
      relImport: relImportFromGeneratedDir(absPath, generatedDir),
    });
  }

  return out;
};
