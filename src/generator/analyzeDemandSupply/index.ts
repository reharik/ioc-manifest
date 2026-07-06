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
  tryEmitTypeReference,
  type EmitTypeReferenceContext,
} from "./emitTypeReference.js";
import { validateNamedDepsType } from "./enforceNamedDepsType.js";
import {
  depsPropertyTypeNodeByName,
  tryParseConsumedGroupAliasKey,
  tryParseIocGeneratedCradleIndexedAccessKey,
} from "./resolveIocGeneratedCradleIndexedAccess.js";
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
  detail: string,
): string => {
  const abs = path.join(projectRoot, loc.modulePath);
  const rel = path.relative(projectRoot, abs).replace(/\\/g, "/");
  return `[ioc] Factory ${JSON.stringify(loc.exportName)} at ${rel}:${loc.line} references an unresolvable deps type for property ${JSON.stringify(propName)}: ${detail}`;
};

const formatUnknownConsumedCradleKeyError = (
  projectRoot: string,
  loc: FactorySourceLocation,
  propName: string,
  key: string,
): string => {
  const abs = path.join(projectRoot, loc.modulePath);
  const rel = path.relative(projectRoot, abs).replace(/\\/g, "/");
  return `[ioc] Factory ${JSON.stringify(loc.exportName)} at ${rel}:${loc.line} references consumed cradle key ${JSON.stringify(key)} on property ${JSON.stringify(propName)} that is not a known registration or group`;
};

type ResolvedFactoryContext = {
  factory: DiscoveredFactory;
  factoryDecl: ts.FunctionLike;
  sourceFile: ts.SourceFile;
};

const resolveFactoryContext = (
  factory: DiscoveredFactory,
  sourceFileByPath: Map<string, ts.SourceFile>,
  projectRoot: string,
  scanDirs: FactoryDiscoveryPaths["scanDirs"],
): ResolvedFactoryContext | undefined => {
  const absPath = normalizePath(
    resolveFactorySourceAbsPath(factory.modulePath, projectRoot, scanDirs),
  );
  const sourceFile = sourceFileByPath.get(absPath);
  if (sourceFile === undefined) {
    return undefined;
  }
  const analysis = collectFileAnalysisForFactoryDiscovery(sourceFile);
  const factoryDecl = analysis.factoryDeclByExport.get(factory.exportName);
  if (factoryDecl === undefined) {
    return undefined;
  }
  return { factory, factoryDecl, sourceFile };
};

const supplyTypeRefForFactory = (
  checker: ts.TypeChecker,
  factory: DiscoveredFactory,
  factoryDecl: ts.FunctionLike,
  emitCtx: EmitTypeReferenceContext,
): EmittedTypeReference => {
  const signature = checker.getSignatureFromDeclaration(factoryDecl);
  if (!signature) {
    return {
      typeName: factory.contractName,
      imports: [
        {
          typeName: factory.contractName,
          relImport: factory.contractTypeRelImport,
          useDefaultImport: false,
        },
      ],
    };
  }
  const returnType = checker.getReturnTypeOfSignature(signature);
  return (
    emitTypeReference(checker, returnType, emitCtx) ?? {
      typeName: factory.contractName,
      imports: [
        {
          typeName: factory.contractName,
          relImport: factory.contractTypeRelImport,
          useDefaultImport: false,
        },
      ],
    }
  );
};

/**
 * Stamps a factory's source location onto each import spec of a resolved type reference that
 * does not already carry one (first writer wins, so an import surfaced by an earlier factory
 * keeps its provenance). The emitter stays factory-agnostic; provenance is attached here.
 */
const stampSourceFactory = (
  typeRef: EmittedTypeReference,
  sourceFactory: FactorySourceLocation,
): EmittedTypeReference => ({
  typeName: typeRef.typeName,
  imports: typeRef.imports.map((imp) =>
    imp.sourceFactory === undefined ? { ...imp, sourceFactory } : imp,
  ),
});

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
  scopeProvided?: readonly string[];
};

/**
 * Walks factories to collect demand/supply pairs, validates named deps and type agreement,
 * and produces cradle entries for {@link buildCradleTypeSource}.
 */
export const analyzeDemandSupply = (
  factories: readonly DiscoveredFactory[],
  options: AnalyzeDemandSupplyOptions,
): DemandSupplyAnalysisResult => {
  const { program, projectRoot, scanDirs, generatedDir, groupsManifest, scopeProvided } =
    options;
  const checker = program.getTypeChecker();
  const localSupplierKeys = collectLocalSupplierKeys(factories, groupsManifest);
  const scopeProvidedSet = new Set(scopeProvided ?? []);

  const sourceFileByPath = new Map<string, ts.SourceFile>();
  for (const sf of program.getSourceFiles()) {
    sourceFileByPath.set(normalizePath(sf.fileName), sf);
  }

  const demandByKey = new Map<
    string,
    { type: ts.Type; factory: FactorySourceLocation; typeRef: EmittedTypeReference }
  >();

  const cradleMap = new Map<string, DemandSupplyCradleEntry>();

  const factoryByRegistrationKey = new Map<string, ResolvedFactoryContext>();
  for (const factory of factories) {
    const ctx = resolveFactoryContext(
      factory,
      sourceFileByPath,
      projectRoot,
      scanDirs,
    );
    if (ctx !== undefined) {
      factoryByRegistrationKey.set(factory.registrationKey, ctx);
    }
  }

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
    if (signature !== undefined) {
      const supplyRef = stampSourceFactory(
        supplyTypeRefForFactory(checker, factory, factoryDecl, emitCtx),
        loc,
      );

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

    const propTypeNodes = depsPropertyTypeNodeByName(checker, named.depsType);
    const props = collectDepsProperties(checker, named.depsType);
    for (const { name: propName, type: propType } of props) {
      const consumedCradleKey =
        tryParseIocGeneratedCradleIndexedAccessKey(
          checker,
          propTypeNodes.get(propName),
        ) ??
        tryParseConsumedGroupAliasKey(
          checker,
          propTypeNodes.get(propName),
          groupsManifest,
        );

      if (consumedCradleKey !== undefined) {
        if (groupsManifest?.[consumedCradleKey] !== undefined) {
          continue;
        }

        const supplier = factoryByRegistrationKey.get(consumedCradleKey);
        if (supplier === undefined) {
          // Hard-abort: one factory with an invalid consumed cradle key blocks the entire gen
          // run (same policy as unresolvable deps and type conflicts in this pass).
          throw new Error(
            formatUnknownConsumedCradleKeyError(
              projectRoot,
              loc,
              propName,
              consumedCradleKey,
            ),
          );
        }

        const supplierEmitCtx: EmitTypeReferenceContext = {
          program,
          projectRoot,
          scanDirs,
          generatedDir,
          contextSourceFile: supplier.sourceFile,
        };
        const supplierSignature = checker.getSignatureFromDeclaration(
          supplier.factoryDecl,
        );
        const supplierReturnType =
          supplierSignature !== undefined
            ? checker.getReturnTypeOfSignature(supplierSignature)
            : propType;
        const supplierLoc = factoryLocation(
          supplier.factory,
          supplier.factoryDecl,
          supplier.sourceFile,
        );
        const resolvedTypeRef = stampSourceFactory(
          supplyTypeRefForFactory(
            checker,
            supplier.factory,
            supplier.factoryDecl,
            supplierEmitCtx,
          ),
          supplierLoc,
        );

        const classification = localSupplierKeys.has(propName)
          ? "local"
          : "external";

        const existing = demandByKey.get(propName);
        if (existing !== undefined) {
          if (
            !typesMutuallyAgree(checker, existing.type, supplierReturnType)
          ) {
            throw new Error(
              formatTypeConflictError(
                propName,
                {
                  factory: existing.factory,
                  typeDisplay: formatTypeDisplay(checker, existing.type),
                },
                {
                  factory: loc,
                  typeDisplay: formatTypeDisplay(checker, supplierReturnType),
                },
                projectRoot,
              ),
            );
          }
        } else {
          demandByKey.set(propName, {
            type: supplierReturnType,
            factory: loc,
            typeRef: resolvedTypeRef,
          });
        }

        mergeEntry(cradleMap, propName, resolvedTypeRef, classification);
        continue;
      }

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

      const emitted = tryEmitTypeReference(checker, propType, emitCtx, {
        propertyName: propName,
      });
      if (!emitted.ok) {
        throw new Error(
          formatUnresolvableDepsError(
            projectRoot,
            loc,
            propName,
            emitted.message,
          ),
        );
      }
      const typeRef = stampSourceFactory(emitted.value, loc);

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

  const rawEntries = Array.from(cradleMap.values()).sort((a, b) =>
    a.key.localeCompare(b.key),
  );

  const entries = rawEntries.map((entry) =>
    entry.classification === "external" && scopeProvidedSet.has(entry.key)
      ? { ...entry, classification: "scope-provided" as const }
      : entry,
  );

  const externalKeys = entries
    .filter((e) => e.classification === "external")
    .map((e) => e.key);

  const scopeProvidedKeys = entries
    .filter((e) => e.classification === "scope-provided")
    .map((e) => e.key);

  return { entries, externalKeys, scopeProvidedKeys };
};
