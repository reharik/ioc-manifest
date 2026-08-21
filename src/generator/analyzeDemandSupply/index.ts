import path from "node:path";
import ts from "typescript";
import type { IocGroupsManifest } from "../../core/manifest.js";
import { collectFileAnalysisForFactoryDiscovery } from "../discoverFactories/scanFactoryFile.js";
import {
  unitContractSiteTypeNode,
  unitDeclNode,
  unitDepsSignatureDecl,
  type DiscoveredUnitDecl,
} from "../discoverFactories/contractSite.js";
import {
  resolveFactorySourceAbsPath,
  type FactoryDiscoveryPaths,
} from "../manifestPaths.js";
import type { DiscoveredFactory, DiscoveredScopeRoot } from "../types.js";
import {
  emitTypeReference,
  formatTypeDisplay,
  isUnresolvableDepsPropertyType,
  tryEmitTypeReference,
  type EmitTypeReferenceContext,
} from "../emit/index.js";
import { assertGeneratedReferenceClaimed } from "./assertGeneratedReferenceClaimed.js";
import { validateNamedDepsType } from "./enforceNamedDepsType.js";
import {
  depsPropertyTypeNodeByName,
  tryParseConsumedGroupAliasKey,
  tryParseConsumedScopeRootOpenerAliasKey,
  tryParseIocGeneratedCradleIndexedAccessKey,
} from "./resolveIocGeneratedCradleIndexedAccess.js";
import {
  openerKeysByTypeAliasName,
  openerKeysForScopeRoots,
} from "../naming.js";
import type {
  DemandingUnitRef,
  DemandSupplyAnalysisResult,
  DemandSupplyCradleEntry,
  FactorySourceLocation,
  EmittedTypeReference,
} from "./types.js";

export type {
  DemandingUnitRef,
  DemandSupplyAnalysisResult,
  DemandSupplyCradleEntry,
} from "./types.js";

const normalizePath = (p: string): string => path.normalize(p);

const typesMutuallyAgree = (
  checker: ts.TypeChecker,
  a: ts.Type,
  b: ts.Type,
): boolean =>
  checker.isTypeAssignableTo(a, b) && checker.isTypeAssignableTo(b, a);

/**
 * The keys this package's cradle will carry without anyone asking the app for them: registration
 * keys, group roots, and — since scope-roots stage 3a — the emitted opener keys.
 *
 * An opener belongs here for the same reason a group root does: it is a registration this run
 * writes, not a value the composing app supplies. `openerKeys` also carries the openers a COMPOSED
 * package contributes, which `composeManifests` registers under those same keys; asking the app for
 * one in `IocExternals` would be asking it to hand-build a scope opener, which is precisely what the
 * feature exists to stop.
 */
const collectLocalSupplierKeys = (
  factories: readonly DiscoveredFactory[],
  groupsManifest: IocGroupsManifest | undefined,
  openerKeys: ReadonlySet<string>,
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
  for (const openerKey of openerKeys) {
    keys.add(openerKey);
  }
  return keys;
};

const unitLocation = (
  unit: ResolvedUnitContext,
): FactorySourceLocation => {
  const pos =
    unit.depsDecl?.parameters[0]?.getStart() ?? unitDeclNode(unit.decl).getStart();
  const { line } = unit.sourceFile.getLineAndCharacterOfPosition(pos);
  return {
    exportName: unit.factory.exportName,
    modulePath: unit.factory.modulePath,
    line: line + 1,
    unitKind: unit.factory.unitKind ?? "factory",
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
  return `[ioc] Factory ${JSON.stringify(loc.exportName)} at ${rel}:${loc.line} references consumed cradle key ${JSON.stringify(key)} on property ${JSON.stringify(propName)} that is not a known registration, group or scope-root opener`;
};

/**
 * One registration unit resolved back to its AST, for both kinds.
 *
 * `decl` is the unit declaration (factory function / class); `depsDecl` is the signature whose
 * first parameter carries dependencies (the factory itself / the class constructor), undefined for
 * a class with no constructor; `contractSite` is the declared contract position (return annotation
 * / `implements` entry).
 */
type ResolvedUnitContext = {
  factory: DiscoveredFactory;
  decl: DiscoveredUnitDecl;
  depsDecl: ts.FunctionLike | undefined;
  contractSite: ts.TypeNode | undefined;
  sourceFile: ts.SourceFile;
};

const resolveUnitContext = (
  checker: ts.TypeChecker,
  factory: DiscoveredFactory,
  sourceFileByPath: Map<string, ts.SourceFile>,
  projectRoot: string,
  scanDirs: FactoryDiscoveryPaths["scanDirs"],
): ResolvedUnitContext | undefined => {
  const absPath = normalizePath(
    resolveFactorySourceAbsPath(factory.modulePath, projectRoot, scanDirs),
  );
  const sourceFile = sourceFileByPath.get(absPath);
  if (sourceFile === undefined) {
    return undefined;
  }
  const analysis = collectFileAnalysisForFactoryDiscovery(sourceFile);
  const decl = analysis.unitDeclByExport.get(factory.exportName);
  if (decl === undefined) {
    return undefined;
  }
  return {
    factory,
    decl,
    depsDecl: unitDepsSignatureDecl(decl),
    contractSite: unitContractSiteTypeNode(checker, decl, factory.contractName),
    sourceFile,
  };
};

const contractFallbackTypeRef = (
  factory: DiscoveredFactory,
): EmittedTypeReference => ({
  typeName: factory.contractName,
  imports: [
    {
      typeName: factory.contractName,
      relImport: factory.contractTypeRelImport,
      useDefaultImport: false,
    },
  ],
});

/**
 * The type a unit supplies to the cradle.
 *
 * Factories keep the checker-resolved return type of their signature (so `Promise<T>` and inferred
 * widening behave exactly as before). A class has no return signature; its supply type is the
 * declared contract site itself, which is the same thing the `implements` clause asserts.
 */
const supplyTypeForUnit = (
  checker: ts.TypeChecker,
  unit: ResolvedUnitContext,
): ts.Type | undefined => {
  if (unit.decl.unitKind === "class") {
    return unit.contractSite !== undefined
      ? checker.getTypeFromTypeNode(unit.contractSite)
      : undefined;
  }
  const signature = checker.getSignatureFromDeclaration(unit.decl.decl);
  return signature !== undefined
    ? checker.getReturnTypeOfSignature(signature)
    : undefined;
};

const supplyTypeRefForUnit = (
  checker: ts.TypeChecker,
  unit: ResolvedUnitContext,
  emitCtx: EmitTypeReferenceContext,
): EmittedTypeReference => {
  const supplyType = supplyTypeForUnit(checker, unit);
  if (supplyType === undefined) {
    return contractFallbackTypeRef(unit.factory);
  }
  return (
    emitTypeReference(checker, supplyType, emitCtx, {
      position: `the cradle supply type of ${unit.factory.exportName} (contract ${unit.factory.contractName}) in ${unit.factory.modulePath}`,
    }) ?? contractFallbackTypeRef(unit.factory)
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
  /**
   * Scope-root units, joined into the walk as CONSUMERS ONLY (scope-roots stage 3).
   *
   * Stage 2 left them invisible here — they are absent from `acceptedFactories` — which forced
   * every root-own demand into the lbv even when it was a genuine container constant. They demand
   * like any other unit now, and supply nothing: a variant claims no cradle key and elects no
   * default, so an unregistered root-own demand flows to `Externals` exactly as a subtree demand
   * does, and the generation-mode classifier's membership rule keeps holding.
   */
  scopeRoots?: readonly DiscoveredScopeRoot[];
  /**
   * Opener keys carried in by composed package manifests (app mode).
   *
   * They are supply, not demand: `composeManifests` registers each one on the root container, so a
   * factory here may inject a library's opener and the composing app is never asked for it. The
   * cross-package reference form is the library's own exported alias, imported from its `iocTypes`
   * export — a name from another package, which this package's syntactic interception neither sees
   * nor needs to; only the KEY has to be known here, and this is it.
   */
  composedOpenerKeys?: readonly string[];
};

/**
 * A scope-root variant in the terms this walk consumes: identity, deps site, contract site.
 *
 * `registrationKey` is the variant name and is used ONLY to look the unit's AST back up; it is
 * never entered into `unitByRegistrationKey` and never reaches a cradle entry, because a variant
 * claims no cradle key. That is what "consumer only" means here.
 */
const scopeRootAsDemandConsumer = (
  variant: DiscoveredScopeRoot,
): DiscoveredFactory => ({
  unitKind: variant.unitKind,
  contractName: variant.contractName,
  contractTypeRelImport: variant.contractTypeRelImport,
  implementationName: variant.variantName,
  exportName: variant.exportName,
  registrationKey: variant.variantName,
  modulePath: variant.modulePath,
  relImport: variant.relImport,
});

/**
 * Walks factories to collect demand/supply pairs, validates named deps and type agreement,
 * and produces cradle entries for {@link buildCradleTypeSource}.
 */
export const analyzeDemandSupply = (
  factories: readonly DiscoveredFactory[],
  options: AnalyzeDemandSupplyOptions,
): DemandSupplyAnalysisResult => {
  const {
    program,
    projectRoot,
    scanDirs,
    generatedDir,
    groupsManifest,
    scopeProvided,
    scopeRoots,
    composedOpenerKeys,
  } = options;
  const checker = program.getTypeChecker();

  // The opener universe, in the two shapes this walk needs it: the KEYS (what a demand may resolve
  // to and what the supply side already has) and the ALIAS NAMES (what the `openerAliasReference`
  // form is recognized against). Locally emitted openers are named by both; a composed package's
  // openers contribute keys only — their alias lives in that package's generated file, under that
  // package's name.
  const localOpenerKeys = openerKeysForScopeRoots(scopeRoots);
  const openerAliasKeys = openerKeysByTypeAliasName(localOpenerKeys);
  const openerAliasNames = new Set(openerAliasKeys.keys());
  const openerKeys = new Set<string>([
    ...localOpenerKeys,
    ...(composedOpenerKeys ?? []),
  ]);

  const localSupplierKeys = collectLocalSupplierKeys(
    factories,
    groupsManifest,
    openerKeys,
  );
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

  /**
   * key -> the units that demanded it. Recorded for every deps property of every consumer, before
   * any classification: what supplies a key is a separate question from who asked for it.
   */
  const demandersByKey = new Map<string, DemandingUnitRef[]>();
  const recordDemand = (
    key: string,
    unit: ResolvedUnitContext,
    suppliesCradleKey: boolean,
  ): void => {
    const demanders = demandersByKey.get(key) ?? [];
    if (
      !demanders.some(
        (d) =>
          d.exportName === unit.factory.exportName &&
          d.modulePath === unit.factory.modulePath,
      )
    ) {
      demanders.push({
        exportName: unit.factory.exportName,
        modulePath: unit.factory.modulePath,
        ...(suppliesCradleKey
          ? { registrationKey: unit.factory.registrationKey }
          : {}),
      });
    }
    demandersByKey.set(key, demanders);
  };

  const unitByRegistrationKey = new Map<string, ResolvedUnitContext>();
  for (const factory of factories) {
    const ctx = resolveUnitContext(
      checker,
      factory,
      sourceFileByPath,
      projectRoot,
      scanDirs,
    );
    if (ctx !== undefined) {
      unitByRegistrationKey.set(factory.registrationKey, ctx);
    }
  }

  /**
   * The walk's consumers, in a fixed order: registration units first (unchanged), then scope-root
   * variants. `suppliesCradleKey` is the whole difference between the two — a variant demands and
   * supplies nothing.
   */
  const consumers: { unit: ResolvedUnitContext; suppliesCradleKey: boolean }[] =
    [];

  for (const factory of factories) {
    const unit = unitByRegistrationKey.get(factory.registrationKey);
    if (unit === undefined || unit.factory !== factory) {
      continue;
    }
    consumers.push({ unit, suppliesCradleKey: true });
  }

  for (const variant of scopeRoots ?? []) {
    const unit = resolveUnitContext(
      checker,
      scopeRootAsDemandConsumer(variant),
      sourceFileByPath,
      projectRoot,
      scanDirs,
    );
    if (unit !== undefined) {
      consumers.push({ unit, suppliesCradleKey: false });
    }
  }

  for (const { unit, suppliesCradleKey } of consumers) {
    const factory = unit.factory;
    const { sourceFile, depsDecl } = unit;

    const loc = unitLocation(unit);
    const emitCtx: EmitTypeReferenceContext = {
      program,
      projectRoot,
      scanDirs,
      generatedDir,
      contextSourceFile: sourceFile,
    };

    // BACKSTOP (see assertGeneratedReferenceClaimed): the contract site feeds the cradle's
    // supply type, so a generated reference there would be resolved out of prior output.
    assertGeneratedReferenceClaimed(
      unit.contractSite,
      checker,
      { projectRoot, generatedDir, openerAliasNames },
      `${unit.decl.unitKind} ${JSON.stringify(factory.exportName)} contract site`,
    );

    // A scope-root variant is a consumer and nothing else: it claims no cradle key, so there is no
    // supply entry to merge. The opener it emits claims a key, and that key is emitted separately.
    if (suppliesCradleKey && supplyTypeForUnit(checker, unit) !== undefined) {
      const supplyRef = stampSourceFactory(
        supplyTypeRefForUnit(checker, unit, emitCtx),
        loc,
      );

      mergeEntry(
        cradleMap,
        factory.registrationKey,
        supplyRef,
        localSupplierKeys.has(factory.registrationKey) ? "local" : "external",
      );
    }

    if (depsDecl === undefined || depsDecl.parameters.length === 0) {
      continue;
    }

    const named = validateNamedDepsType(
      checker,
      depsDecl,
      projectRoot,
      loc,
    );
    if (!named.ok) {
      throw new Error(named.message);
    }

    // BACKSTOP: the deps type's own SHAPE (an intersection or alias chain reaching the generated
    // file) absorbs the previous cradle's members wholesale. Its individual properties are checked
    // one by one below, after the claim parsers have had their turn at each.
    assertGeneratedReferenceClaimed(
      depsDecl.parameters[0]?.type,
      checker,
      { projectRoot, generatedDir, openerAliasNames },
      `${unit.decl.unitKind} ${JSON.stringify(factory.exportName)} deps type`,
    );

    const propTypeNodes = depsPropertyTypeNodeByName(checker, named.depsType);
    const props = collectDepsProperties(checker, named.depsType);
    for (const { name: propName, type: propType } of props) {
      recordDemand(propName, unit, suppliesCradleKey);

      const consumedCradleKey =
        tryParseIocGeneratedCradleIndexedAccessKey(
          checker,
          propTypeNodes.get(propName),
          generatedDir,
        ) ??
        tryParseConsumedGroupAliasKey(
          checker,
          propTypeNodes.get(propName),
          groupsManifest,
          generatedDir,
        ) ??
        tryParseConsumedScopeRootOpenerAliasKey(
          checker,
          propTypeNodes.get(propName),
          openerAliasKeys,
          generatedDir,
        );

      if (consumedCradleKey === undefined) {
        // BACKSTOP: every claim parser declined, so this property is about to be handed to the
        // checker. If it still reaches the generated file, resolving it would read prior output.
        assertGeneratedReferenceClaimed(
          propTypeNodes.get(propName),
          checker,
          { projectRoot, generatedDir, openerAliasNames },
          `${unit.decl.unitKind} ${JSON.stringify(factory.exportName)} deps property ${JSON.stringify(propName)}`,
        );
      }

      if (consumedCradleKey !== undefined) {
        if (groupsManifest?.[consumedCradleKey] !== undefined) {
          continue;
        }

        // An opener key is supplied by emission, not by this walk: locally, `writeManifest` writes
        // the cradle property from the planned opener; across packages, `composeManifests`
        // registers the key it carried in. Either way the reference is carried BY NAME — both
        // spellings (`OpenAuthRouterScope`, `IocGeneratedCradle["openAuthRouterScope"]`) land here
        // and neither is ever expanded member-by-member.
        if (openerKeys.has(consumedCradleKey)) {
          continue;
        }

        const supplier = unitByRegistrationKey.get(consumedCradleKey);
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
        const supplierReturnType =
          supplyTypeForUnit(checker, supplier) ?? propType;
        const supplierLoc = unitLocation(supplier);
        const resolvedTypeRef = stampSourceFactory(
          supplyTypeRefForUnit(checker, supplier, supplierEmitCtx),
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

      const depsPosition = `the deps type of ${loc.exportName} in ${loc.modulePath}`;

      if (
        isUnresolvableDepsPropertyType(checker, propType, emitCtx, {
          propertyName: propName,
          position: depsPosition,
        })
      ) {
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
        position: depsPosition,
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

  return { entries, externalKeys, scopeProvidedKeys, demandersByKey };
};
