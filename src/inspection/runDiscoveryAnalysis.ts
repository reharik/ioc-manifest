import path from "node:path";
import type { IocConfig } from "../config/iocConfig.js";
import type { ResolvedContractRegistration } from "../generator/resolveRegistrationPlan.js";
import { buildRegistrationPlan } from "../generator/resolveRegistrationPlan.js";
import type {
  DiscoveredFactory,
  DiscoveredScopeRoot,
} from "../generator/types.js";
import {
  resolveIocConfigPath,
  resolveProjectRootFromIocConfigPath,
  tryLoadIocConfig,
} from "../config/loadIocConfig.js";
import { discoverFactories } from "../generator/discoverFactories/discoverFactories.js";
import {
  createIocProgramForDiscovery,
  getConfigExcludedFiles,
  getDiscoveryTargetFiles,
  loadIocTsconfigContext,
  logDiscoveryProgramErrorDiagnosticsForFailure,
} from "../generator/iocProgramContext.js";
import { isAppMode } from "../config/iocMode.js";
import { loadComposedManifestSupply } from "../generator/loadComposedManifestUnits.js";
import { computeDiscoveryModulePath } from "../generator/manifestPaths.js";
import {
  mergeManifestOptionsWithIocConfig,
  resolveManifestOptions,
  type ManifestOptions,
} from "../generator/manifestOptions.js";
import type { ManifestRuntimePaths } from "../generator/manifestPaths.js";
import type { IocDiscoveryAnalysisFiles } from "../generator/discoverFactories/discoveryOutcomeTypes.js";
import { resolveLifetimeMarkersForFactories } from "../generator/resolveLifetimeMarkers.js";
import {
  buildScopeRootSupplyIndex,
  verifyScopeRoots,
  type ScopeRootVerificationResult,
} from "../generator/verifyScopeRoots.js";
import {
  demandersFromUnitEdges,
  resolveExternalsExclusion,
  type ScopeRootSharedSubtreeUnit,
} from "../generator/scopeRootExternalsExclusion.js";
import {
  analyzeGroupPlan,
  type GroupPlan,
} from "../groups/resolveGroupPlan.js";

export type DiscoveryAnalysisResult = {
  readonly discoveryFiles: IocDiscoveryAnalysisFiles;
  readonly contractMap: Map<string, Map<string, DiscoveredFactory>>;
  readonly acceptedFactories: readonly DiscoveredFactory[];
  /**
   * Scope-root units, separate from `acceptedFactories` because they take no part in the
   * registration plan at this stage. See `docs/design/scope-roots.md`.
   */
  readonly scopeRoots: readonly DiscoveredScopeRoot[];
  /** Resolved lifetimes (includes `lifetimeSource` when built with scanDirs context). */
  readonly registrationPlan: readonly ResolvedContractRegistration[];
  /**
   * Stage-2 demand–supply verification, one entry per scope-root variant. Run in tolerate mode so
   * the report lists every offender rather than dying on the first aggregated failure.
   */
  readonly scopeRootVerification: ScopeRootVerificationResult;
  /**
   * Units demanding a declared late-bound value from inside a declaring subtree while also being
   * reachable from outside it — the reason such a key stays in `IocExternals`.
   *
   * Computed from units' own dependency edges, since inspection runs no demand/supply pass. That is
   * the same edge set the subtree walk uses and a subset of what generation sees, so this view stays
   * permissive in the direction the rest of scope-root inspection already is: generation is the
   * authority, and inspection must never claim something generation does not.
   */
  readonly scopeRootSharedUnits: readonly ScopeRootSharedSubtreeUnit[];
  /**
   * Configured group plans with membership and the candidates the membership pass rejected. Built
   * with the non-throwing analyzer: a group config error must show up as an empty groups section in
   * the report, never as a crashed inspect.
   */
  readonly groupPlans: readonly GroupPlan[];
  /**
   * Module paths the config's `discovery.excludes` kept out of the scan. Resolved here rather than
   * read off discovery outcomes: excluded files never enter the scan set, so the scanner has no
   * occasion to emit a row for them.
   */
  readonly excludedFiles: readonly string[];
};

export type DiscoveryManifestResolution = {
  readonly cfgPath: string;
  readonly config: IocConfig | undefined;
  readonly options: ManifestOptions;
};

export const resolveDiscoveryManifestContext = async (opts?: {
  iocConfigPath?: string;
  /** Directory to start searching upward for `ioc.config.ts` (defaults to `paths.projectRoot` or cwd). */
  searchStartDir?: string;
  paths?: Partial<ManifestRuntimePaths>;
}): Promise<DiscoveryManifestResolution> => {
  const searchStart = path.resolve(
    opts?.searchStartDir ?? opts?.paths?.projectRoot ?? process.cwd(),
  );
  const cfgPath = resolveIocConfigPath(searchStart, opts?.iocConfigPath);
  const config = await tryLoadIocConfig(cfgPath);
  const projectRoot = config
    ? resolveProjectRootFromIocConfigPath(cfgPath)
    : opts?.paths?.projectRoot ?? searchStart;
  const base = resolveManifestOptions({
    paths: {
      ...opts?.paths,
      projectRoot,
    },
  });
  const options = config
    ? mergeManifestOptionsWithIocConfig(base, config)
    : base;
  return { cfgPath, config, options };
};

/**
 * `customConditions` from the project's tsconfig, or none when it has no readable one.
 *
 * Inspection has never required a tsconfig and must not start: it builds its program from an
 * explicit file list precisely so that a project without one can still be reported on. Custom
 * conditions only sharpen composed-package export resolution; losing them can at worst leave a
 * package unresolved, which is already a disclosed blind spot rather than a crash.
 */
const tsconfigCustomConditions = (
  projectRoot: string,
): readonly string[] | undefined => {
  try {
    return loadIocTsconfigContext(projectRoot).customConditions;
  } catch {
    return undefined;
  }
};

const runDiscoveryFromResolution = async (
  resolved: DiscoveryManifestResolution,
): Promise<DiscoveryAnalysisResult> => {
  const { config, options } = resolved;
  const {
    paths: { projectRoot, scanDirs, generatedDir },
    includePatterns,
    excludePatterns,
    factoryExportPrefix,
  } = options;

  const files = await getDiscoveryTargetFiles(
    scanDirs,
    includePatterns,
    excludePatterns,
    generatedDir,
  );
  // Inspection-only: the scan set itself is untouched, so excluded files are still never parsed —
  // only named. Reported as files, never as exports: counting their exports would mean scanning
  // exactly the files the config asked us not to scan.
  const excludedAbsPaths = await getConfigExcludedFiles(
    scanDirs,
    includePatterns,
    excludePatterns,
    generatedDir,
  );
  const excludedFiles = excludedAbsPaths
    .map((abs) => computeDiscoveryModulePath(abs, projectRoot, scanDirs))
    .sort((a, b) => a.localeCompare(b));
  const program = createIocProgramForDiscovery(projectRoot, files);

  try {
    const { contractMap, acceptedFactories, discoveryFiles, scopeRoots } =
      discoverFactories(
        files,
        program,
        projectRoot,
        factoryExportPrefix,
        { projectRoot, scanDirs, generatedDir },
        config ?? undefined,
        // tolerateInvalidAnnotations: the discovery report must list every offender (missing /
        // invalid return annotations) instead of dying on the aggregated generation error.
        { collectFileRecords: true, tolerateInvalidAnnotations: true },
      );

    const markerLifetimesByFactoryKey = resolveLifetimeMarkersForFactories(
      acceptedFactories,
      config?.lifetimeMarkers,
      { program, projectRoot, scanDirs },
    );

    const registrationPlan = buildRegistrationPlan(contractMap, config, {
      projectRoot,
      scanDirs,
      markerLifetimesByFactoryKey,
    });

    // Inspection has no group plan (groups are a codegen artifact) and no demand/supply pass, so it
    // cannot expand a group root key into its members and has no authoritative externals set. It is
    // still not allowed to claim unsatisfied for a key generation satisfies: group root keys are
    // recognised from `config.groups` and reported as container-supplied, and the externals verdict
    // falls out of the classifier's fallback. Reported, never thrown: the report is a view, and
    // generation remains the authority that fails the run.
    // Composed supply, so the report's subtree walk crosses package boundaries the same way
    // generation's does — the false "declared but never demanded" the report used to print for a
    // key only a composed unit demands came from not having this. Tolerant: a package that cannot
    // be resolved thins the report (and is disclosed as a blind spot), never crashes it, which is
    // the same stance every other part of inspection takes.
    const composedSupply =
      config !== undefined && config !== null && isAppMode(config)
        ? await loadComposedManifestSupply(
            projectRoot,
            config.composedManifests!,
            {
              customConditions: tsconfigCustomConditions(projectRoot),
              tolerateUnreadablePackages: true,
            },
          )
        : undefined;

    const scopeRootVerification = verifyScopeRoots(scopeRoots, {
      program,
      projectRoot,
      scanDirs,
      acceptedFactories,
      plans: registrationPlan,
      config: config ?? undefined,
      composedSupply,
    });

    const scopeRootSharedUnits =
      scopeRoots.length === 0
        ? []
        : resolveExternalsExclusion({
            variants: scopeRootVerification.variants,
            demandersByKey: demandersFromUnitEdges(
              acceptedFactories,
              scopeRoots,
            ),
            acceptedFactories,
            scopeRoots,
            supplyIndex: buildScopeRootSupplyIndex({
              program,
              projectRoot,
              scanDirs,
              acceptedFactories,
              plans: registrationPlan,
              config: config ?? undefined,
              composedSupply,
            }),
          }).sharedSubtreeUnits;

    // Groups are a codegen artifact, so inspection recomputes rather than reads them. Non-throwing:
    // a bad `groups` entry must not take down `ioc inspect --discovery`, whose job is to report.
    const groupAnalysis = analyzeGroupPlan(config?.groups, registrationPlan, {
      program,
      generatedDir,
      scanDirs,
    });

    return {
      discoveryFiles,
      contractMap,
      acceptedFactories,
      scopeRoots,
      registrationPlan,
      scopeRootVerification,
      scopeRootSharedUnits,
      groupPlans: groupAnalysis.plans,
      excludedFiles,
    };
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

/**
 * Re-runs factory discovery from source (and TypeScript) for inspection / CLI.
 * Does not read or write the generated manifest.
 */
export const runDiscoveryAnalysis = async (opts?: {
  iocConfigPath?: string;
  searchStartDir?: string;
  paths?: Partial<ManifestRuntimePaths>;
  /** When set, skips config loading (e.g. after {@link resolveDiscoveryManifestContext}). */
  reuseResolution?: DiscoveryManifestResolution;
}): Promise<DiscoveryAnalysisResult> => {
  const resolved =
    opts?.reuseResolution ?? (await resolveDiscoveryManifestContext(opts));
  return runDiscoveryFromResolution(resolved);
};
