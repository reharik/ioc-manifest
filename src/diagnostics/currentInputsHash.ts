/**
 * @fileoverview Re-reads a package's sources and fingerprints them the way generation did.
 *
 * The other half of the freshness check: `generationState.ts` records what generation saw, this
 * recomputes what is there now, and `freshness.ts` compares the two. It is separated from both
 * because it is the only piece that has to RESOLVE a package — find its config, merge its options,
 * glob its scan set — and that resolution is the part that can fail benignly.
 *
 * ### Every failure is `undefined`
 *
 * A package can be unfingerprintable for entirely ordinary reasons: it was published with its
 * manifest but not its sources, its config throws on load, its scan dirs no longer exist. None of
 * those is evidence about staleness, so none of them throws and none of them returns a hash that
 * would compare as a mismatch. They return `undefined`, which the caller reports as "unknown" —
 * one quiet line, not a warning.
 */
import {
  resolvePackageLocalIocConfigPath,
  resolveProjectRootFromIocConfigPath,
  tryLoadIocConfig,
} from "../config/loadIocConfig.js";
import type { IocConfig } from "../config/iocConfig.js";
import { hashGenerationInputs } from "./generationState.js";
import { getDiscoveryTargetFiles } from "../generator/iocProgramContext.js";
import {
  mergeManifestOptionsWithIocConfig,
  resolveManifestOptions,
} from "../generator/manifestOptions.js";

/**
 * The fingerprint of a package's sources as they are RIGHT NOW, given its already-resolved config.
 *
 * For the running package, where the caller loaded the config to do its real work and passing it
 * back in costs nothing. The scan set is resolved through the same
 * {@link getDiscoveryTargetFiles} generation uses, so the two sides of the comparison cannot
 * disagree about what "the scanned files" means.
 */
export const currentInputsHashForConfig = async (
  projectRoot: string,
  configPath: string,
  config: IocConfig,
): Promise<string | undefined> => {
  try {
    const options = mergeManifestOptionsWithIocConfig(
      resolveManifestOptions({ paths: { projectRoot } }),
      config,
    );
    const files = await getDiscoveryTargetFiles(
      options.paths.scanDirs,
      options.includePatterns,
      options.excludePatterns,
      options.paths.generatedDir,
    );
    return hashGenerationInputs(projectRoot, configPath, files);
  } catch {
    return undefined;
  }
};

/**
 * The same fingerprint from a config PATH, loading the config itself.
 *
 * For callers that know where a package's config is but have not loaded it — `ioc inspect` and
 * `ioc explain`, which resolved the path to find the manifest and never needed the object. The
 * package root is derived from the config path exactly the way generation derives it, so the two
 * sides of the comparison agree on what the scan dirs are relative to.
 */
export const currentInputsHashForConfigPath = async (
  configPath: string,
): Promise<string | undefined> => {
  let config: IocConfig | undefined;
  try {
    config = await tryLoadIocConfig(configPath);
  } catch {
    return undefined;
  }
  if (config === undefined) {
    return undefined;
  }
  return currentInputsHashForConfig(
    resolveProjectRootFromIocConfigPath(configPath),
    configPath,
    config,
  );
};

/**
 * The same fingerprint for a package named only by its directory — a composed dependency.
 *
 * Its config is looked up WITHOUT walking upward: a composed package that has no config of its own
 * must come back unknown, not be fingerprinted against the monorepo root's scan set, which would
 * compare one package's sources to another package's record and mismatch essentially always.
 */
export const currentInputsHashForPackageRoot = async (
  packageRoot: string,
): Promise<string | undefined> => {
  const configPath = resolvePackageLocalIocConfigPath(packageRoot);
  return configPath === undefined
    ? undefined
    : currentInputsHashForConfigPath(configPath);
};
