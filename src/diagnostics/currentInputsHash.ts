/**
 * @fileoverview Re-reads a package's sources and fingerprints them the way generation did.
 *
 * The other half of the freshness check: `generationState.ts` records what generation saw, this
 * recomputes what is there now, and `freshness.ts` compares the two. It is separated from both
 * because it is the only piece that has to RESOLVE a package — find its config, merge its options,
 * glob its scan set — and that resolution is the part that can fail benignly.
 *
 * ### The set is the discovery set, never a guess
 *
 * Every file this reads comes back from {@link getDiscoveryTargetFiles} — the same function
 * generation discovers through, given the package's own config. There is no fallback: no package
 * root walked "just to have something", no bare recursive scan when a config is missing. A package
 * whose config or scan dirs will not resolve is reported unknown, because a fingerprint over a
 * DIFFERENT set of files than generation read is not a weaker answer, it is a wrong one — it
 * mismatches essentially always and calls every package stale.
 *
 * ### Every failure is unknown
 *
 * A package can be unfingerprintable for entirely ordinary reasons: it was published with its
 * manifest but not its sources, its config throws on load, its scan dirs no longer exist. None of
 * those is evidence about staleness, so none of them throws and none of them returns a hash that
 * would compare as a mismatch. They return no hash, which the caller reports as "unknown" —
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
import type { FreshnessUnknownReason } from "./freshness.js";

/**
 * The most files this will fingerprint for one package before declining.
 *
 * A freshness heuristic must never dominate the run it advises on. Hashing costs roughly 100µs a
 * file, so this ceiling bounds the whole check at well under a second — against the 223 seconds a
 * field run spent here when a scan root turned out to contain a package boundary.
 *
 * Sized against what a package's sources actually are, not against what a machine can survive: the
 * largest scan set measured in the field was 482 files, and this is an order of magnitude above it.
 * A set past this point is not a big package, it is a scan root pointed at something wider than one
 * package — a monorepo root, a build output tree — and fingerprinting it would answer a question
 * about the wrong files, slowly. Declining and saying the number is the more useful answer.
 */
export const MAX_FINGERPRINTED_SOURCE_FILES = 5_000;

/**
 * What the sources fingerprint to right now, or why they do not.
 *
 * A result rather than `string | undefined` because the ceiling breach is a THIRD outcome: not a
 * hash, and not the ordinary "sources could not be re-read" either. The reader who trips it needs
 * the count, and a bare `undefined` cannot carry one.
 */
export type CurrentInputsFingerprint = {
  /** Present exactly when the sources were fingerprinted. */
  readonly hash?: string;
  /** Present exactly when {@link hash} is absent. */
  readonly unknown?: {
    readonly reason: FreshnessUnknownReason;
    readonly detail?: string;
  };
};

const UNREADABLE: CurrentInputsFingerprint = {
  unknown: { reason: "unreadable-sources" },
};

/**
 * The fingerprint of a package's sources as they are RIGHT NOW, given its already-resolved config.
 *
 * For the running package, where the caller loaded the config to do its real work and passing it
 * back in costs nothing. The scan set is resolved through the same
 * {@link getDiscoveryTargetFiles} generation uses, so the two sides of the comparison cannot
 * disagree about what "the scanned files" means.
 */
export const currentInputsForConfig = async (
  projectRoot: string,
  configPath: string,
  config: IocConfig,
): Promise<CurrentInputsFingerprint> => {
  let files: string[];
  try {
    const options = mergeManifestOptionsWithIocConfig(
      resolveManifestOptions({ paths: { projectRoot } }),
      config,
    );
    files = await getDiscoveryTargetFiles(
      options.paths.scanDirs,
      options.includePatterns,
      options.excludePatterns,
      options.paths.generatedDir,
    );
  } catch {
    return UNREADABLE;
  }

  if (files.length > MAX_FINGERPRINTED_SOURCE_FILES) {
    return {
      unknown: {
        reason: "source-set-too-large",
        detail: `${files.length} files resolved, over the ${MAX_FINGERPRINTED_SOURCE_FILES}-file ceiling`,
      },
    };
  }

  try {
    return { hash: hashGenerationInputs(projectRoot, configPath, files) };
  } catch {
    return UNREADABLE;
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
export const currentInputsForConfigPath = async (
  configPath: string,
): Promise<CurrentInputsFingerprint> => {
  let config: IocConfig | undefined;
  try {
    config = await tryLoadIocConfig(configPath);
  } catch {
    return UNREADABLE;
  }
  if (config === undefined) {
    return UNREADABLE;
  }
  return currentInputsForConfig(
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
 *
 * No config means no answer, full stop. Nothing here falls back to walking the package root — a
 * package root is not a scan set, and the one time that shape was reachable it walked out through
 * `node_modules` symlinks into the whole workspace.
 */
export const currentInputsForPackageRoot = async (
  packageRoot: string,
): Promise<CurrentInputsFingerprint> => {
  const configPath = resolvePackageLocalIocConfigPath(packageRoot);
  return configPath === undefined
    ? UNREADABLE
    : currentInputsForConfigPath(configPath);
};
