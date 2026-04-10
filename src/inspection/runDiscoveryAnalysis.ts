import path from "node:path";
import type { IocConfig } from "../config/iocConfig.js";
import type { DiscoveredFactory } from "../generator/types.js";
import {
  resolveIocConfigPath,
  resolveProjectRootFromIocConfigPath,
  tryLoadIocConfig,
} from "../config/loadIocConfig.js";
import { discoverFactories } from "../generator/discoverFactories/discoverFactories.js";
import {
  createIocProgramForDiscovery,
  getDiscoveryTargetFiles,
  reportDiscoveryProgramDiagnostics,
} from "../generator/iocProgramContext.js";
import {
  mergeManifestOptionsWithIocConfig,
  resolveManifestOptions,
  type ManifestOptions,
} from "../generator/manifestOptions.js";
import type { ManifestRuntimePaths } from "../generator/manifestPaths.js";
import type { IocDiscoveryAnalysisFiles } from "../generator/discoverFactories/discoveryOutcomeTypes.js";

export type DiscoveryAnalysisResult = {
  readonly discoveryFiles: IocDiscoveryAnalysisFiles;
  readonly contractMap: Map<string, Map<string, DiscoveredFactory>>;
  readonly acceptedFactories: readonly DiscoveredFactory[];
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
  reportDiscoveryProgramDiagnostics(program, projectRoot, files);

  const { contractMap, acceptedFactories, discoveryFiles } = discoverFactories(
    files,
    program,
    projectRoot,
    factoryExportPrefix,
    { projectRoot, scanDirs, generatedDir },
    config ?? undefined,
    { collectFileRecords: true },
  );

  return {
    discoveryFiles,
    contractMap,
    acceptedFactories,
  };
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
