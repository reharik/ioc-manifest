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
  getDiscoveryTargetFiles,
  logDiscoveryProgramErrorDiagnosticsForFailure,
} from "../generator/iocProgramContext.js";
import {
  mergeManifestOptionsWithIocConfig,
  resolveManifestOptions,
  type ManifestOptions,
} from "../generator/manifestOptions.js";
import type { ManifestRuntimePaths } from "../generator/manifestPaths.js";
import type { IocDiscoveryAnalysisFiles } from "../generator/discoverFactories/discoveryOutcomeTypes.js";
import { resolveLifetimeMarkersForFactories } from "../generator/resolveLifetimeMarkers.js";
import {
  verifyScopeRoots,
  type ScopeRootVerificationResult,
} from "../generator/verifyScopeRoots.js";

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
    const scopeRootVerification = verifyScopeRoots(scopeRoots, {
      program,
      projectRoot,
      scanDirs,
      acceptedFactories,
      plans: registrationPlan,
      config: config ?? undefined,
    });

    return {
      discoveryFiles,
      contractMap,
      acceptedFactories,
      scopeRoots,
      registrationPlan,
      scopeRootVerification,
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
