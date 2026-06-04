/**
 * @fileoverview Resolves factory lifetimes from `lifetimeMarkers` config via return-type
 * nominal heritage matching. Reuses {@link resolveDeclaredBaseType} from groups; user-facing
 * cost is dominated by factory discovery, not marker checks.
 */
import path from "node:path";
import ts from "typescript";
import type { IocLifetime } from "../config/iocConfig.js";
import {
  isNominallyAssignable,
  resolveDeclaredBaseType,
} from "../groups/baseTypeAssignability.js";
import { collectFileAnalysisForFactoryDiscovery } from "./discoverFactories/scanFactoryFile.js";
import {
  resolveFactorySourceAbsPath,
  type FactoryDiscoveryPaths,
  type ResolvedScanDir,
} from "./manifestPaths.js";
import type { DiscoveredFactory } from "./types.js";

export type ResolvedLifetimeMarker = {
  name: string;
  lifetime: IocLifetime;
  type: ts.Type;
};

export type LifetimeMarkerMatch = {
  name: string;
  lifetime: IocLifetime;
};

export type LifetimeMarkerResolutionDeps = {
  resolveMarkerType: (markerName: string) => ResolvedLifetimeMarker;
  isAssignableToMarker: (
    candidateType: ts.Type,
    marker: ResolvedLifetimeMarker,
  ) => boolean;
};

const normalizePath = (p: string): string => path.normalize(p);

export const factoryLifetimeMarkerKey = (
  factory: DiscoveredFactory,
): string => `${factory.modulePath}:${factory.exportName}`;

const formatFactoryLocation = (
  factory: DiscoveredFactory,
  factoryDecl: ts.FunctionLike,
  sourceFile: ts.SourceFile,
  projectRoot: string,
): string => {
  const pos =
    factoryDecl.parameters[0]?.getStart() ?? factoryDecl.getStart();
  const { line } = sourceFile.getLineAndCharacterOfPosition(pos);
  const abs = path.join(projectRoot, factory.modulePath);
  const rel = path.relative(projectRoot, abs).replace(/\\/g, "/");
  return `${rel}:${line + 1}`;
};

const formatMultipleLifetimeMarkersError = (
  factory: DiscoveredFactory,
  location: string,
  matches: readonly LifetimeMarkerMatch[],
): string => {
  const markerLines = matches
    .map(
      (match) =>
        `  - "${match.name}" → ${match.lifetime}`,
    )
    .join("\n");
  return `[ioc] Factory "${factory.exportName}" at ${location} has multiple lifetime markers in its return type:
${markerLines}
Lifetime is ambiguous. Either remove one marker from the type's inheritance chain, or set lifetime explicitly via registrations.<Contract>.<impl>.lifetime in your ioc.config.ts.`;
};

export const resolveLifetimeMarkerTypes = (
  program: ts.Program,
  lifetimeMarkers: Record<string, IocLifetime>,
): readonly ResolvedLifetimeMarker[] => {
  const checker = program.getTypeChecker();
  const out: ResolvedLifetimeMarker[] = [];

  for (const [name, lifetime] of Object.entries(lifetimeMarkers).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    const resolved = resolveDeclaredBaseType(program, checker, name);
    if (!resolved.ok) {
      throw new Error(
        `[ioc-config] lifetimeMarkers.${JSON.stringify(name)}: ${resolved.message}`,
      );
    }
    out.push({ name, lifetime, type: resolved.type });
  }

  return out;
};

const defaultMarkerResolutionDeps = (
  program: ts.Program,
  markers: readonly ResolvedLifetimeMarker[],
): LifetimeMarkerResolutionDeps => {
  const checker = program.getTypeChecker();
  const markerByName = new Map(markers.map((marker) => [marker.name, marker]));

  return {
    resolveMarkerType: (markerName: string): ResolvedLifetimeMarker => {
      const marker = markerByName.get(markerName);
      if (marker === undefined) {
        throw new Error(
          `[ioc] internal error: unknown lifetime marker ${JSON.stringify(markerName)}`,
        );
      }
      return marker;
    },
    isAssignableToMarker: (
      candidateType: ts.Type,
      marker: ResolvedLifetimeMarker,
    ): boolean =>
      isNominallyAssignable(checker, candidateType, marker.type),
  };
};

const collectMatchingMarkers = (
  returnType: ts.Type,
  markers: readonly ResolvedLifetimeMarker[],
  deps: LifetimeMarkerResolutionDeps,
): LifetimeMarkerMatch[] => {
  const matches: LifetimeMarkerMatch[] = [];
  for (const marker of markers) {
    if (deps.isAssignableToMarker(returnType, marker)) {
      matches.push({ name: marker.name, lifetime: marker.lifetime });
    }
  }
  return matches;
};

const getFactoryReturnType = (
  program: ts.Program,
  factory: DiscoveredFactory,
  discoveryPaths: FactoryDiscoveryPaths,
  sourceFileByPath: ReadonlyMap<string, ts.SourceFile>,
): ts.Type | undefined => {
  const absPath = normalizePath(
    resolveFactorySourceAbsPath(
      factory.modulePath,
      discoveryPaths.projectRoot,
      discoveryPaths.scanDirs,
    ),
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

  const checker = program.getTypeChecker();
  const signature = checker.getSignatureFromDeclaration(factoryDecl);
  if (signature === undefined) {
    return undefined;
  }

  return checker.getReturnTypeOfSignature(signature);
};

export type ResolveLifetimeMarkersForFactoriesOptions = {
  program: ts.Program;
  projectRoot: string;
  scanDirs: readonly ResolvedScanDir[];
  /** Injectable for tests (assignability call counting). */
  deps?: LifetimeMarkerResolutionDeps;
};

/**
 * Maps each factory to a marker-resolved lifetime. When `lifetimeMarkers` is empty, returns an
 * empty map immediately — zero assignability checks (perf contract for library-mode packages
 * that omit lifetimeMarkers).
 */
export const resolveLifetimeMarkersForFactories = (
  factories: readonly DiscoveredFactory[],
  lifetimeMarkers: Record<string, IocLifetime> | undefined,
  options: ResolveLifetimeMarkersForFactoriesOptions,
): ReadonlyMap<string, IocLifetime> => {
  if (
    lifetimeMarkers === undefined ||
    Object.keys(lifetimeMarkers).length === 0
  ) {
    // Perf contract: skip marker analysis entirely when no markers are declared.
    return new Map();
  }

  const { program, projectRoot, scanDirs, deps: depsOverride } = options;
  const markers = resolveLifetimeMarkerTypes(program, lifetimeMarkers);
  const deps =
    depsOverride ?? defaultMarkerResolutionDeps(program, markers);

  const sourceFileByPath = new Map<string, ts.SourceFile>();
  for (const sf of program.getSourceFiles()) {
    sourceFileByPath.set(normalizePath(sf.fileName), sf);
  }

  const discoveryPaths: FactoryDiscoveryPaths = {
    projectRoot,
    scanDirs: [...scanDirs],
    generatedDir: "",
  };

  const out = new Map<string, IocLifetime>();

  for (const factory of factories) {
    const returnType = getFactoryReturnType(
      program,
      factory,
      discoveryPaths,
      sourceFileByPath,
    );
    if (returnType === undefined) {
      continue;
    }

    const matches = collectMatchingMarkers(returnType, markers, deps);
    if (matches.length === 0) {
      continue;
    }
    if (matches.length > 1) {
      const absPath = normalizePath(
        resolveFactorySourceAbsPath(
          factory.modulePath,
          projectRoot,
          scanDirs,
        ),
      );
      const sourceFile = sourceFileByPath.get(absPath);
      const analysis =
        sourceFile !== undefined
          ? collectFileAnalysisForFactoryDiscovery(sourceFile)
          : undefined;
      const factoryDecl = analysis?.factoryDeclByExport.get(factory.exportName);
      const location =
        sourceFile !== undefined && factoryDecl !== undefined
          ? formatFactoryLocation(factory, factoryDecl, sourceFile, projectRoot)
          : factory.modulePath;
      throw new Error(
        formatMultipleLifetimeMarkersError(factory, location, matches),
      );
    }

    out.set(factoryLifetimeMarkerKey(factory), matches[0]!.lifetime);
  }

  return out;
};

/** Validates marker names resolve in the program (used when markers are non-empty). */
export const assertLifetimeMarkerTypesResolvable = (
  program: ts.Program,
  lifetimeMarkers: Record<string, IocLifetime> | undefined,
): void => {
  if (
    lifetimeMarkers === undefined ||
    Object.keys(lifetimeMarkers).length === 0
  ) {
    return;
  }
  resolveLifetimeMarkerTypes(program, lifetimeMarkers);
};
