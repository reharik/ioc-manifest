import path from "node:path";
import ts from "typescript";
import type { IocGroupsManifest } from "../../core/manifest.js";
import { collectFileAnalysisForFactoryDiscovery } from "../discoverFactories/scanFactoryFile.js";
import {
  resolveFactorySourceAbsPath,
  type FactoryDiscoveryPaths,
} from "../manifestPaths.js";
import type { DiscoveredFactory } from "../types.js";
import {
  emitTypeReference,
  formatTypeDisplay,
  isUnresolvableDepsPropertyType,
  type EmitTypeReferenceContext,
} from "./emitTypeReference.js";
import { validateNamedDepsType } from "./enforceNamedDepsType.js";
import type {
  DemandSupplyAnalysisResult,
  DemandSupplyCradleEntry,
  FactorySourceLocation,
  EmittedTypeReference,
} from "./types.js";

export type { DemandSupplyAnalysisResult, DemandSupplyCradleEntry } from "./types.js";

const normalizePath = (p: string): string => path.normalize(p);

const typesMutuallyAgree = (
  checker: ts.TypeChecker,
  a: ts.Type,
  b: ts.Type,
): boolean =>
  checker.isTypeAssignableTo(a, b) && checker.isTypeAssignableTo(b, a);

const collectLocalSupplierKeys = (
  factories: readonly DiscoveredFactory[],
  groupsManifest: IocGroupsManifest | undefined,
): Set<string> => {
  const keys = new Set<string>();
  for (const factory of factories) {
    keys.add(factory.registrationKey);
  }
  if (groupsManifest !== undefined) {
    for (const groupKey of Object.keys(groupsManifest)) {
      keys.add(groupKey);
    }
  }
  return keys;
};

const factoryLocation = (
  factory: DiscoveredFactory,
  factoryDecl: ts.FunctionLike,
  sourceFile: ts.SourceFile,
): FactorySourceLocation => {
  const pos =
    factoryDecl.parameters[0]?.getStart() ?? factoryDecl.getStart();
  const { line } = sourceFile.getLineAndCharacterOfPosition(pos);
  return {
    exportName: factory.exportName,
    modulePath: factory.modulePath,
    line: line + 1,
  };
};

const collectDepsProperties = (
  checker: ts.TypeChecker,
  depsType: ts.Type,
): { name: string; type: ts.Type }[] => {
  const apparent = checker.getApparentType(depsType);
  const out: { name: string; type: ts.Type }[] = [];

  for (const prop of checker.getPropertiesOfType(apparent)) {
    const name = prop.getName();
    if (name.startsWith("__")) {
      continue;
    }
    const propType = checker.getTypeOfSymbol(prop);
    out.push({ name, type: propType });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
};

const formatTypeConflictError = (
  key: string,
  first: { factory: FactorySourceLocation; typeDisplay: string },
  second: { factory: FactorySourceLocation; typeDisplay: string },
  projectRoot: string,
): string => {
  const fmt = (loc: FactorySourceLocation, typeDisplay: string): string => {
    const abs = path.join(projectRoot, loc.modulePath);
    const rel = path.relative(projectRoot, abs).replace(/\\/g, "/");
    return `  - Factory ${JSON.stringify(loc.exportName)} at ${rel}:${loc.line} declares ${key}: ${typeDisplay}`;
  };

  return `[ioc] Conflicting types for demanded key ${JSON.stringify(key)}:
${fmt(first.factory, first.typeDisplay)}
${fmt(second.factory, second.typeDisplay)}`;
};

const formatUnresolvableDepsError = (
  projectRoot: string,
  loc: FactorySourceLocation,
  propName: string,
  typeDisplay: string,
): string => {
  const abs = path.join(projectRoot, loc.modulePath);
  const rel = path.relative(projectRoot, abs).replace(/\\/g, "/");
  return `[ioc] Factory ${JSON.stringify(loc.exportName)} at ${rel}:${loc.line} references an unresolvable type in deps for property ${JSON.stringify(propName)}: ${typeDisplay}`;
};

const mergeEntry = (
  map: Map<string, DemandSupplyCradleEntry>,
  key: string,
  typeRef: EmittedTypeReference,
  classification: "local" | "external",
): void => {
  const existing = map.get(key);
  if (existing !== undefined) {
    map.set(key, {
      key,
      typeRef,
      classification:
        existing.classification === "local" || classification === "local"
          ? "local"
          : "external",
    });
    return;
  }
  map.set(key, { key, typeRef, classification });
};

export type AnalyzeDemandSupplyOptions = FactoryDiscoveryPaths & {
  program: ts.Program;
  projectRoot: string;
  groupsManifest?: IocGroupsManifest;
};

/**
 * Walks factories to collect demand/supply pairs, validates named deps and type agreement,
 * and produces cradle entries for {@link buildCradleTypeSource}.
 */
export const analyzeDemandSupply = (
  factories: readonly DiscoveredFactory[],
  options: AnalyzeDemandSupplyOptions,
): DemandSupplyAnalysisResult => {
  const { program, projectRoot, scanDirs, generatedDir, groupsManifest } =
    options;
  const checker = program.getTypeChecker();
  const localSupplierKeys = collectLocalSupplierKeys(factories, groupsManifest);

  const sourceFileByPath = new Map<string, ts.SourceFile>();
  for (const sf of program.getSourceFiles()) {
    sourceFileByPath.set(normalizePath(sf.fileName), sf);
  }

  const demandByKey = new Map<
    string,
    { type: ts.Type; factory: FactorySourceLocation; typeRef: EmittedTypeReference }
  >();

  const cradleMap = new Map<string, DemandSupplyCradleEntry>();

  for (const factory of factories) {
    const absPath = normalizePath(
      resolveFactorySourceAbsPath(factory.modulePath, projectRoot, scanDirs),
    );
    const sourceFile = sourceFileByPath.get(absPath);
    if (!sourceFile) {
      continue;
    }

    const analysis = collectFileAnalysisForFactoryDiscovery(sourceFile);
    const factoryDecl = analysis.factoryDeclByExport.get(factory.exportName);
    if (!factoryDecl) {
      continue;
    }

    const loc = factoryLocation(factory, factoryDecl, sourceFile);
    const emitCtx: EmitTypeReferenceContext = {
      program,
      projectRoot,
      scanDirs,
      generatedDir,
      contextSourceFile: sourceFile,
    };

    const signature = checker.getSignatureFromDeclaration(factoryDecl);
    if (signature) {
      const returnType = checker.getReturnTypeOfSignature(signature);
      const supplyRef =
        emitTypeReference(checker, returnType, emitCtx) ??
        ({
          typeName: factory.contractName,
          relImport: factory.contractTypeRelImport,
          useDefaultImport: false,
        } satisfies EmittedTypeReference);

      mergeEntry(
        cradleMap,
        factory.registrationKey,
        supplyRef,
        localSupplierKeys.has(factory.registrationKey) ? "local" : "external",
      );
    }

    if (factoryDecl.parameters.length === 0) {
      continue;
    }

    const named = validateNamedDepsType(
      checker,
      factoryDecl,
      projectRoot,
      loc,
    );
    if (!named.ok) {
      throw new Error(named.message);
    }

    const props = collectDepsProperties(checker, named.depsType);
    for (const { name: propName, type: propType } of props) {
      if (isUnresolvableDepsPropertyType(checker, propType, emitCtx)) {
        throw new Error(
          formatUnresolvableDepsError(
            projectRoot,
            loc,
            propName,
            formatTypeDisplay(checker, propType),
          ),
        );
      }

      const typeRef = emitTypeReference(checker, propType, emitCtx);
      if (typeRef === undefined) {
        throw new Error(
          formatUnresolvableDepsError(
            projectRoot,
            loc,
            propName,
            formatTypeDisplay(checker, propType),
          ),
        );
      }

      const classification = localSupplierKeys.has(propName)
        ? "local"
        : "external";

      const existing = demandByKey.get(propName);
      if (existing !== undefined) {
        if (!typesMutuallyAgree(checker, existing.type, propType)) {
          throw new Error(
            formatTypeConflictError(
              propName,
              {
                factory: existing.factory,
                typeDisplay: formatTypeDisplay(checker, existing.type),
              },
              {
                factory: loc,
                typeDisplay: formatTypeDisplay(checker, propType),
              },
              projectRoot,
            ),
          );
        }
      } else {
        demandByKey.set(propName, {
          type: propType,
          factory: loc,
          typeRef,
        });
      }

      mergeEntry(cradleMap, propName, typeRef, classification);
    }
  }

  const entries = Array.from(cradleMap.values()).sort((a, b) =>
    a.key.localeCompare(b.key),
  );

  const externalKeys = entries
    .filter((e) => e.classification === "external")
    .map((e) => e.key);

  return { entries, externalKeys };
};
