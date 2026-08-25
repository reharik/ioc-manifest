/**
 * @fileoverview Orchestrates manifest generation: load config, discover factories via TypeScript,
 * build registration + group plans, emit `ioc-manifest.ts` and `ioc-registry.types.ts`, then
 * format with Prettier when available.
 *
 * In APP MODE the run also judges the composition it performs, via the shared composition suite
 * (`runCompositionSuiteAtCodegen.ts`) — the same checks `ioc validate` runs, over the same program,
 * against the artifacts this run is about to write and before any of them is written.
 */
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  tryLoadIocConfig,
  resolveIocConfigPath,
  resolveProjectRootFromIocConfigPath,
} from "../config/loadIocConfig.js";
import { discoverFactories } from "./discoverFactories/discoverFactories.js";
import { formatGeneratedFileWithPrettier } from "./formatGeneratedFile.js";
import {
  createIocProgramForDiscovery,
  getDiscoveryTargetFiles,
  loadIocTsconfigContext,
  logDiscoveryProgramErrorDiagnosticsForFailure,
} from "./iocProgramContext.js";
import {
  mergeManifestOptionsWithIocConfig,
  ManifestOptions,
  resolveManifestOptions,
} from "./manifestOptions.js";
import { analyzeDemandSupply } from "./analyzeDemandSupply/index.js";
import { buildRegistrationPlan } from "./resolveRegistrationPlan.js";
import {
  buildManifestArtifactSources,
  writeGeneratedFilesAtomically,
} from "./writeManifest.js";
import type { ManifestRuntimePaths } from "./manifestPaths.js";
import { buildGroupPlan } from "../groups/resolveGroupPlan.js";
import { buildBoundedGroupCollectionTypeRefs } from "../groups/boundedGroupCollectionType.js";
import {
  isAppMode,
  isLibraryMode,
  resolveManifestExportPath,
} from "../config/iocMode.js";
import { loadComposedManifestContractNames } from "./loadComposedManifestContracts.js";
import {
  loadComposedManifestGroupNames,
  validateGroupBaseTypeAliasKeysAtCodegen,
} from "./loadComposedManifestGroups.js";
import { loadComposedManifestOpenerKeys } from "./loadComposedManifestScopeRoots.js";
import { loadComposedManifestSupply } from "./loadComposedManifestUnits.js";
import { buildComposedRegistrationOverridesFromConfig } from "./buildComposedRegistrationOverrides.js";
import {
  buildComposedManifestSource,
  removeComposedManifestIfPresent,
} from "./writeComposedManifest.js";
import { loadComposedPackageSpecs } from "./loadComposedPackageExternalKeys.js";
import { resolveLifetimeMarkersForFactories } from "./resolveLifetimeMarkers.js";
import { validateScopeProvidedAtCodegen } from "./validateScopeProvidedAtCodegen.js";
import { validateLifetimeInversionsAtCodegen } from "./validateLifetimeInversionsAtCodegen.js";
import {
  buildScopeRootSupplyIndex,
  verifyScopeRootsAtCodegen,
} from "./verifyScopeRoots.js";
import {
  buildScopeRootOpeners,
  validateScopeRootEmissionAtCodegen,
} from "./scopeRootOpeners.js";
import { resolveExternalsExclusion } from "./scopeRootExternalsExclusion.js";
import { contractSlotsForPlans } from "./contractSlotKeys.js";
import {
  resolveGroupedContracts,
  type GroupedContractIndex,
} from "../groups/groupedContracts.js";
import { validateGroupLifetimeAtCodegen } from "./validateGroupLifetimeAtCodegen.js";
import { resolveLifetimeMarkerTypes } from "./resolveLifetimeMarkers.js";
import { contractNameToDefaultRegistrationKey } from "./naming.js";
import type { DemandGroupMembership } from "./analyzeDemandSupply/namedInstanceDemand.js";
import {
  IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS,
  type IocGroupsManifest,
  type IocGroupLeafManifest,
} from "../core/manifest.js";
import { validateGeneratedReferencesAtCodegen } from "./validateGeneratedReferencesAtCodegen.js";
import { validateNonEmptyGroupsAtCodegen } from "./validateNonEmptyGroupsAtCodegen.js";
import { validateContractSlotOccupancyAtCodegen } from "./validateContractSlotOccupancyAtCodegen.js";
import { runCompositionSuiteAtCodegen } from "./runCompositionSuiteAtCodegen.js";
import {
  buildComposedGroupDemandIndex,
  mergeWithLocalPrecedence,
} from "./composedGroupMembership.js";
import {
  GENERATION_FAILURE_ARTIFACTS_NOTE,
  generationStatePathFor,
  hashGenerationInputs,
  writeGenerationRecord,
} from "../diagnostics/generationState.js";
import { offenderCountOf } from "../diagnostics/offenderCount.js";
import {
  resetPhaseTimings,
  timePhase,
  timePhaseAsync,
} from "../diagnostics/phaseTiming.js";
import { warnUnusableFactoryExports } from "./warnUnusableFactoryExports.js";
import { warnDivergentClassFileNames } from "./warnDivergentClassFileNames.js";

/**
 * Group membership in the terms the demand rule reads it, with the group's cradle key and — for a
 * record group — the property that member is exposed under, so the error can say what to write
 * instead rather than only what not to.
 */
const demandGroupMemberships = (
  grouped: GroupedContractIndex,
  groupsManifest: IocGroupsManifest | undefined,
): ReadonlyMap<string, DemandGroupMembership> => {
  const out = new Map<string, DemandGroupMembership>();
  for (const [contractName, membership] of grouped.byContractName) {
    const root = groupsManifest?.[membership.groupName];
    const memberProperty =
      root !== undefined && !Array.isArray(root.members)
        ? Object.entries(
            root.members as Record<string, IocGroupLeafManifest>,
          ).find(([, leaf]) => leaf.contractName === contractName)?.[0]
        : undefined;
    out.set(contractName, {
      groupName: membership.groupName,
      kind: membership.kind,
      baseType: membership.baseType,
      groupKey: membership.groupName,
      ...(memberProperty !== undefined ? { memberProperty } : {}),
    });
  }
  return out;
};

/** Would-be contract key → grouped contract name, for the "there is no contract key" diagnosis. */
const absentGroupedSlotKeys = (
  grouped: GroupedContractIndex,
): ReadonlyMap<string, string> =>
  new Map(
    [...grouped.byContractName.keys()].map((contractName) => [
      contractNameToDefaultRegistrationKey(contractName),
      contractName,
    ]),
  );

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { name?: unknown };
const packageName =
  typeof packageJson.name === "string" && packageJson.name.length > 0
    ? packageJson.name
    : "ioc-manifest";

type GenerateManifestOverrides = Partial<Omit<ManifestOptions, "paths">> & {
  paths?: Partial<ManifestRuntimePaths>;
  iocConfigPath?: string;
};

/**
 * What the failure path needs, filled in as the run learns it.
 *
 * Mutable and deliberately partial: a run can fail before it has resolved its config, and the
 * marker still has to land somewhere sensible. Each field is written the moment it is known, so
 * whatever the failure interrupts, the catch has the best answer available at that point.
 */
type GenerationFailureContext = {
  projectRoot: string;
  generatedDir?: string;
  configPath?: string;
  discoveryFiles?: readonly string[];
};

/**
 * Records a failing generation so the artifact-reading verbs can say the artifacts are stale.
 *
 * Best effort and never rethrows: a generation error is already propagating, and replacing it with
 * a filesystem error from the bookkeeping would hide the thing the developer needs to read.
 *
 * When the run failed before resolving its config there is no configured `generatedDir` to sit
 * beside, so the marker lands beside the DEFAULT one for the project root the run started from —
 * the same place a successful run would have cleared it from. That is the honest choice: a marker
 * somewhere a reader will look beats no marker at all, and the surfaces that read it resolve their
 * own generated dir the same way.
 */
const recordGenerationFailure = async (
  ctx: GenerationFailureContext,
  error: unknown,
): Promise<void> => {
  const generatedDir =
    ctx.generatedDir ??
    resolveManifestOptions({ paths: { projectRoot: ctx.projectRoot } }).paths
      .generatedDir;

  const inputsHash =
    ctx.discoveryFiles !== undefined
      ? hashGenerationInputs(
          ctx.projectRoot,
          ctx.configPath,
          ctx.discoveryFiles,
        )
      : undefined;

  await writeGenerationRecord(generationStatePathFor(generatedDir), {
    outcome: "failed",
    at: new Date().toISOString(),
    errorCount: offenderCountOf(error),
    ...(inputsHash !== undefined ? { inputsHash } : {}),
  });
};

/**
 * Full generation pipeline for a consuming project. Idempotent writes use atomic rename.
 *
 * @param overrides - Optional paths, glob patterns, factory prefix, or explicit `iocConfigPath`.
 *                    When `ioc.config.ts` is absent, defaults from {@link resolveManifestOptions} apply.
 */
export const generateManifest = async (
  overrides?: GenerateManifestOverrides,
): Promise<void> => {
  const failureContext: GenerationFailureContext = {
    projectRoot: path.resolve(overrides?.paths?.projectRoot ?? process.cwd()),
  };
  try {
    await runGeneration(overrides, failureContext);
  } catch (error) {
    await recordGenerationFailure(failureContext, error);
    console.error(GENERATION_FAILURE_ARTIFACTS_NOTE);
    throw error;
  }
};

const runGeneration = async (
  overrides: GenerateManifestOverrides | undefined,
  failureContext: GenerationFailureContext,
): Promise<void> => {
  resetPhaseTimings();
  const searchStart = path.resolve(
    overrides?.paths?.projectRoot ?? process.cwd(),
  );
  const configPath = resolveIocConfigPath(
    searchStart,
    overrides?.iocConfigPath,
  );
  const config = await timePhaseAsync("config: load ioc.config", () =>
    tryLoadIocConfig(configPath),
  );
  const resolvedProjectRoot = config
    ? resolveProjectRootFromIocConfigPath(configPath)
    : searchStart;
  const base = resolveManifestOptions({
    ...overrides,
    paths: {
      ...overrides?.paths,
      projectRoot: resolvedProjectRoot,
    },
  });
  const options = config
    ? mergeManifestOptionsWithIocConfig(base, config)
    : base;

  const {
    paths: { projectRoot, scanDirs, generatedDir, manifestOutPath },
    includePatterns,
    excludePatterns,
    factoryExportPrefix,
  } = options;

  failureContext.projectRoot = projectRoot;
  failureContext.generatedDir = generatedDir;
  if (config !== undefined) {
    failureContext.configPath = configPath;
  }

  await fs.mkdir(generatedDir, { recursive: true });

  const files = await timePhaseAsync("discovery: file glob", () =>
    getDiscoveryTargetFiles(
      scanDirs,
      includePatterns,
      excludePatterns,
      generatedDir,
    ),
  );
  failureContext.discoveryFiles = files;
  const tsconfigContext = timePhase("discovery: tsconfig", () =>
    loadIocTsconfigContext(projectRoot),
  );
  const program = timePhase("discovery: TypeScript program", () =>
    createIocProgramForDiscovery(projectRoot, files, tsconfigContext),
  );

  try {
    // Must run before any type-sensitive pass: an unintercepted reference form (re-export or
    // import() type targeting the generated file) fails the run before it can poison demand
    // analysis with types resolved from prior generated output.
    timePhase("check: generated references", () =>
      validateGeneratedReferencesAtCodegen(files, program, {
        projectRoot,
        generatedDir,
      }),
    );

    const { contractMap, acceptedFactories, discoveryFiles, scopeRoots } =
      timePhase("discovery: factories", () =>
        discoverFactories(
          files,
          program,
          projectRoot,
          factoryExportPrefix,
          { projectRoot, scanDirs, generatedDir },
          config,
          { collectFileRecords: true },
        ),
      );

    warnUnusableFactoryExports(discoveryFiles);
    warnDivergentClassFileNames(acceptedFactories, config);

    const composedContractNames =
      config !== undefined && isAppMode(config)
        ? await timePhaseAsync("composed: contract names", () =>
            loadComposedManifestContractNames(
              projectRoot,
              config.composedManifests!,
              tsconfigContext.customConditions,
            ),
          )
        : undefined;

    // GROUPED ⇒ GROUP-ONLY, decided before anything that depends on it.
    //
    // Membership is a nominal-heritage relation between contract types and configured base types, so
    // it is answerable from discovery alone — which it has to be, because the registration plan's own
    // default election depends on the answer: a grouped contract backs no slot, so it is never put
    // through election, and election is what hard-errors on the very shape a group exists for
    // (several implementations, no `default: true`). `buildGroupPlan` below stays the authoritative
    // membership pass; this index answers the same question through the same predicate, earlier.
    const groupDiscovery = { program, generatedDir, scanDirs };
    const discoveredContracts = acceptedFactories.map((factory) => ({
      contractName: factory.contractName,
      contractTypeRelImport: factory.contractTypeRelImport,
    }));
    const groupedContracts = timePhase("groups: membership", () =>
      resolveGroupedContracts(
        config?.groups,
        discoveredContracts,
        groupDiscovery,
        {
          markers:
            config?.lifetimeMarkers !== undefined &&
            Object.keys(config.lifetimeMarkers).length > 0
              ? resolveLifetimeMarkerTypes(program, config.lifetimeMarkers)
              : [],
        },
      ),
    );

    // Ruling 2, before marker resolution: a member carrying its own marker would otherwise surface as
    // the generic multiple-markers error, which names the symptom rather than the rule it breaks.
    timePhase("check: group lifetimes", () =>
      validateGroupLifetimeAtCodegen({
        contracts: discoveredContracts,
        grouped: groupedContracts,
        config,
        discovery: groupDiscovery,
        projectRoot,
        factories: acceptedFactories,
      }),
    );

    const markerLifetimesByFactoryKey = timePhase("lifetime markers", () =>
      resolveLifetimeMarkersForFactories(
        acceptedFactories,
        config?.lifetimeMarkers,
        {
          program,
          projectRoot,
          scanDirs,
        },
      ),
    );

    const plans = timePhase("plan: registrations", () =>
      buildRegistrationPlan(
        contractMap,
        config,
        {
          projectRoot,
          scanDirs,
          composedContractNames,
          markerLifetimesByFactoryKey,
        },
        {
          groupedContractNames: new Set(groupedContracts.byContractName.keys()),
          groupNameByContractName: new Map(
            [...groupedContracts.byContractName].map(([name, membership]) => [
              name,
              membership.groupName,
            ]),
          ),
          baseMarkerLifetimeByGroup: groupedContracts.baseMarkerLifetimeByGroup,
        },
      ),
    );
    // Slot occupancy, as soon as both facts exist: the election is resolved and every registration
    // key is known. Before anything reads a slot key, because a slot key that hands out someone other
    // than the electee makes every layer downstream — cradle, demand/supply, the subtree walk — agree
    // on a name that means two things.
    validateContractSlotOccupancyAtCodegen(plans);

    const groupResult = timePhase("plan: groups", () =>
      buildGroupPlan(config?.groups, plans, {
        program,
        generatedDir,
        scanDirs,
      }),
    );

    // App mode: a locally-empty group root is legitimate when the same group key exists in a
    // composed package manifest — its members merge in at runtime via `composeManifests`.
    const composedGroupNames =
      config !== undefined && isAppMode(config)
        ? (
            await timePhaseAsync("composed: group names", () =>
              loadComposedManifestGroupNames(
                projectRoot,
                config.composedManifests!,
                tsconfigContext.customConditions,
              ),
            )
          ).all
        : undefined;

    validateNonEmptyGroupsAtCodegen(
      groupResult?.manifest,
      config,
      composedGroupNames,
    );

    // Ordering invariant: `buildGroupPlan` must finish before `analyzeDemandSupply`.
    // Demand analysis resolves `IocGeneratedCradle['<key>']` against `groupsManifest` and
    // the factory supply map; calling demand analysis first yields spurious
    // "not a known registration, group or scope-root opener" errors on valid group consumers.
    // Scope-root stage 3: variants join the walk as consumers. They still supply nothing and claim no
    // contract key — what changes is that a root-own demand is now visible, so it reaches the
    // externals set (and the `Externals` interface) like any other unregistered demand instead of
    // being invisible to everything downstream.
    // Openers a composed package already registers. Loaded before demand analysis because they are
    // part of its supply side: a factory here that injects a library's opener is asking for a key
    // composition provides, not for one the app must promise in `IocExternals`.
    const composedOpenerKeys =
      config !== undefined && isAppMode(config)
        ? await timePhaseAsync("composed: opener keys", () =>
            loadComposedManifestOpenerKeys(
              projectRoot,
              config.composedManifests!,
              tsconfigContext.customConditions,
            ),
          )
        : undefined;

    // Registration units, contract aliases and group roots the composed packages bring with them.
    // The scope-root subtree walk needs them to cross the package boundary at all: without them a
    // composed key is a leaf, and everything a composed unit demands under a scope root is invisible.
    const composedSupply =
      config !== undefined && isAppMode(config)
        ? await timePhaseAsync("composed: manifest supply", () =>
            loadComposedManifestSupply(projectRoot, config.composedManifests!, {
              customConditions: tsconfigContext.customConditions,
            }),
          )
        : undefined;

    // Group membership the composed manifests carry, projected onto the demand rule's indexes. Read
    // from the SAME merged supply the walk reads, so the two cannot disagree about which composed
    // contracts are grouped.
    const composedGroupDemand = buildComposedGroupDemandIndex(composedSupply);

    // Contract slot keys join the static layers here: they are supply (the runtime registers every
    // one as `aliasTo(elected)`), and they are the row of the demand model a bare contract-name
    // property means. Derived from the plans, after election has run and before anything reads a
    // demand — so the cradle, the demand/supply pass and the scope-root walk all name the same set.
    const contractSlots = contractSlotsForPlans(plans);

    const demandSupply = timePhase("analysis: demand/supply", () =>
      analyzeDemandSupply(acceptedFactories, {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
        groupsManifest: groupResult?.manifest,
        scopeProvided: config?.scopeProvided,
        scopeRoots,
        composedOpenerKeys,
        contractSlots,
        // Grouped ⇒ group-only reaches across the package boundary here. The local index is decided
        // from this package's sources and `config.groups`; a composed package's group roots state the
        // same fact about ITS members, and merging the two is what lets all four doors — bare member
        // key, `Named<MemberContract>`, `Named<GroupBase>`, and the would-be contract key — recognize a
        // member that lives in a library. Without it a composed member's demand landed on
        // `named-marker-required`, whose advice the group law forbids, and then on `[externals]`.
        groupMemberships: mergeWithLocalPrecedence(
          demandGroupMemberships(groupedContracts, groupResult?.manifest),
          composedGroupDemand.membershipByContractName,
        ),
        absentGroupedSlotKeys: mergeWithLocalPrecedence(
          absentGroupedSlotKeys(groupedContracts),
          composedGroupDemand.absentSlotKeyToContractName,
        ),
        // Composed rows reach the named-instance rule only. `Named<C>` has to be checkable against an
        // implementation in another package, and the composed manifest is where its contract is
        // written down; what SUPPLIES a composed key is unchanged — composition, through `IocExternals`.
        composedImplementations: composedSupply?.units.map((unit) => ({
          registrationKey: unit.registrationKey,
          contractName: unit.contractName,
          packageName: unit.packageName,
        })),
        composedSlots: composedSupply?.accessKeys,
      }),
    );

    validateScopeProvidedAtCodegen(config?.scopeProvided ?? [], demandSupply);

    timePhase("check: lifetime inversions", () =>
      validateLifetimeInversionsAtCodegen(
        acceptedFactories,
        plans,
        groupResult?.manifest,
        demandSupply,
        config,
      ),
    );

    // Scope-root stage 2. Runs after the registration plan, the group plan and the demand/supply pass
    // exist — all three are the container-supplied side a scope-demand is measured against — and after
    // the ordinary lifetime pass, so a subtree's own inversions are reported once, by the global
    // check, before the scope-root-specific ones. Scope roots still reach no manifest: this pass
    // verifies and reports, and emits nothing.
    const scopeRootVerification = timePhase("scope roots: verification", () =>
      verifyScopeRootsAtCodegen(scopeRoots, {
        program,
        projectRoot,
        scanDirs,
        acceptedFactories,
        plans,
        groupsManifest: groupResult?.manifest,
        config,
        externalKeys: demandSupply.externalKeys,
        composedSupply,
      }),
    );

    // Stage 3 emission. Openers are planned only after verification has passed: an opener's signature
    // is its variant's declared lbv, and emitting one from a declaration the subtree contradicts
    // would publish a boundary contract the tool has just said is wrong.
    const scopeRootOpeners = timePhase("scope roots: openers", () =>
      buildScopeRootOpeners(scopeRoots, {
        program,
        projectRoot,
        scanDirs,
        generatedDir,
      }),
    );

    // The stage-1 collision exemptions end here: a scope-rooted contract that is also ordinarily
    // registered is a hard error, and opener keys join the same global key namespace registrations
    // and group roots live in.
    validateScopeRootEmissionAtCodegen(scopeRoots, scopeRootOpeners, {
      acceptedFactories,
      plans,
      groupsManifest: groupResult?.manifest,
      reservedManifestKeys: IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS,
    });

    // Externals exclusion reasons across variants — legitimate here and ONLY here, because it decides
    // emission and never satisfaction. A declared key is excluded only when every demand of it in the
    // package sits inside the subtree of a variant that declares it; anything else resolving the key
    // does so from the container, which must therefore still be asked to have one.
    //
    // `config.scopeProvided` is not subject to that predicate. It is an explicit statement that the
    // key enters at a scope boundary, and an explicit statement outranks an inference drawn from
    // declarations, so it is unioned on afterwards.
    const scopeRootExclusion = timePhase(
      "scope roots: externals exclusion",
      () =>
        resolveExternalsExclusion({
          variants: scopeRootVerification.variants,
          demandersByKey: demandSupply.demandersByKey,
          acceptedFactories,
          scopeRoots,
          supplyIndex: buildScopeRootSupplyIndex({
            program,
            projectRoot,
            scanDirs,
            acceptedFactories,
            plans,
            groupsManifest: groupResult?.manifest,
            config,
            composedSupply,
          }),
        }),
    );
    const externalsExcludedKeys = new Set<string>([
      ...(config?.scopeProvided ?? []),
      ...scopeRootExclusion.excludedKeys,
    ]);

    if (demandSupply.scopeProvidedKeys.length > 0) {
      console.log(
        `[ioc] scope-provided values: ${demandSupply.scopeProvidedKeys.join(", ")} — register these onto the request child scope at runtime before resolving dependent services.`,
      );
    }

    const boundedGroupCollectionTypeRefs = buildBoundedGroupCollectionTypeRefs(
      groupResult?.manifest,
      { program, generatedDir, scanDirs, projectRoot },
    );

    const writeOptions = {
      demandSupply,
      registryTypesBuildContext: {
        program,
        generatedDir,
        scanDirs,
        projectRoot,
      },
      boundedGroupCollectionTypeRefs,
      scopeRootOpeners,
      externalsExcludedKeys,
    };

    const artifactSources = timePhase("emit: artifact sources", () =>
      buildManifestArtifactSources(
        acceptedFactories,
        plans,
        groupResult?.manifest,
        manifestOutPath,
        packageName,
        writeOptions,
      ),
    );

    const filesToWrite: { path: string; contents: string }[] = [
      { path: manifestOutPath, contents: artifactSources.mainSource },
      {
        path: artifactSources.typesPath,
        contents: artifactSources.typesSource,
      },
    ];

    let composedOutPath: string | undefined;
    if (config !== undefined && isAppMode(config)) {
      const configPath = resolveIocConfigPath(
        resolvedProjectRoot,
        overrides?.iocConfigPath,
      );
      await validateGroupBaseTypeAliasKeysAtCodegen(
        resolvedProjectRoot,
        config,
        configPath,
        tsconfigContext.customConditions,
      );
      const composedPackages = loadComposedPackageSpecs(
        resolvedProjectRoot,
        config.composedManifests!,
        tsconfigContext.customConditions,
      );
      const composedOverrides =
        buildComposedRegistrationOverridesFromConfig(config);
      composedOutPath = path.join(generatedDir, "ioc-composed.ts");
      const composedSource = buildComposedManifestSource({
        generatedDir,
        composedPackages,
        overrides: composedOverrides,
      });
      filesToWrite.push({ path: composedOutPath, contents: composedSource });

      // The composition suite — the same checks `ioc validate` runs, over the same program. Here,
      // and not earlier: every input it judges is now final (election, groups, demand/supply,
      // scope-root openers, the composed manifest source), so it sees the composed picture this run
      // would actually emit. And here, and not later: it reads the artifacts from `filesToWrite`
      // rather than from disk and throws before a single one is written, so a run that finds errors
      // leaves the previous output untouched rather than shipping something that composes wrongly.
      await timePhaseAsync("composition suite", () =>
        runCompositionSuiteAtCodegen({
          projectRoot: resolvedProjectRoot,
          configPath,
          config,
          sourceFiles: files,
          tsconfig: tsconfigContext,
          pendingLocalArtifacts: {
            manifestPath: manifestOutPath,
            manifestSource: artifactSources.mainSource,
            typesPath: artifactSources.typesPath,
            typesSource: artifactSources.typesSource,
            composedPath: composedOutPath,
            composedSource,
          },
        }),
      );
    }

    try {
      // Success RECORDS as part of the same step that publishes the artifacts: the moment these files
      // become the newest truth is the moment their inputs are worth fingerprinting, and any gap
      // between the two would leave a record describing sources these artifacts were not built from.
      //
      // It used to remove the marker here instead. Removal said only "the last run did not fail",
      // which is silent about the case that brought this file back — a run that succeeded, and then
      // the sources moved underneath its output. The fingerprint is what makes that sayable.
      await writeGeneratedFilesAtomically(filesToWrite, {
        recordOnSuccess: {
          path: generationStatePathFor(generatedDir),
          record: {
            outcome: "success",
            at: new Date().toISOString(),
            // `config !== undefined` and not the bare path: when no config exists, `configPath` is
            // the legacy default for a file that is not there, and fingerprinting an absent file
            // would record the unreadable-config sentinel as if it were content.
            inputsHash: hashGenerationInputs(
              projectRoot,
              config !== undefined ? configPath : undefined,
              files,
            ),
          },
        },
      });
    } catch (error) {
      if (composedOutPath !== undefined) {
        await removeComposedManifestIfPresent(generatedDir);
      }
      throw error;
    }

    if (config === undefined || isLibraryMode(config)) {
      await removeComposedManifestIfPresent(generatedDir);
    }

    // Sequential, not `Promise.all`: prettier's own formatting is CPU-bound and the artifacts are
    // two or three files, so concurrency would buy nothing and would interleave any warning.
    await formatGeneratedFileWithPrettier(manifestOutPath, projectRoot);
    await formatGeneratedFileWithPrettier(artifactSources.typesPath, projectRoot);
    if (composedOutPath !== undefined) {
      await formatGeneratedFileWithPrettier(composedOutPath, projectRoot);
    }

    const relManifest = path.relative(projectRoot, manifestOutPath);
    console.log(
      `Generated ${relManifest} — ${acceptedFactories.length} module factory(ies), ${contractMap.size} contract(s).`,
    );

    if (config !== undefined && isLibraryMode(config)) {
      console.log(
        `Manifest export path (configure package.json exports): ${resolveManifestExportPath(config)}`,
      );
    }

    if (config !== undefined && isAppMode(config)) {
      console.log(
        `App mode: composed ${config.composedManifests!.length} package manifest(s)`,
      );
      for (const pkg of config.composedManifests!) {
        console.log(`  - ${pkg} → import from '${pkg}/iocManifest'`);
      }
      if (composedOutPath !== undefined) {
        console.log(`Generated ${path.relative(projectRoot, composedOutPath)}`);
      }
    }
  } catch (error) {
    logDiscoveryProgramErrorDiagnosticsForFailure(
      program,
      projectRoot,
      files,
      error,
    );
    throw error;
  }
};
