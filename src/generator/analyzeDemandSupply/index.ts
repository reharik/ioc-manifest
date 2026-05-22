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
  type EmitTypeReferenceContext,
} from "./emitTypeReference.js";
import type {
  DemandSupplyAnalysisResult,
  DemandSupplyCradleEntry,
  EmittedTypeReference,
} from "./types.js";

export type { DemandSupplyAnalysisResult, DemandSupplyCradleEntry } from "./types.js";

const normalizePath = (p: string): string => path.normalize(p);

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
 * Walks factories to collect demand/supply pairs and classify local vs external keys.
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

    const paramNode = factoryDecl.parameters[0]!;
    const paramSymbol = signature?.getParameters()[0];
    if (!paramSymbol) {
      continue;
    }

    const depsType = checker.getApparentType(
      checker.getTypeOfSymbolAtLocation(paramSymbol, paramNode),
    );
    const props = collectDepsProperties(checker, depsType);
    for (const { name: propName, type: propType } of props) {
      const typeRef = emitTypeReference(checker, propType, emitCtx);
      if (typeRef === undefined) {
        continue;
      }

      const classification = localSupplierKeys.has(propName)
        ? "local"
        : "external";

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
