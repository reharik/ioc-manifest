/**
 * @fileoverview Generation-time warning for exports that matched the factory prefix but could not
 * be turned into registrations. Discovery records these skips into per-file outcomes, but until
 * generation surfaced them the only consumer was the on-demand `ioc --discovery` report — so a
 * factory silently dropped (e.g. a bare-union return annotation) produced a successful generation
 * with a hole in the registry. This summary makes every unusable prefix-matched export visible
 * during `generate` itself.
 *
 * Only export-scoped skips whose reason means "looked like a factory, could not be used" warn.
 * `NO_MATCHING_EXPORT` and `NO_FACTORY_PATTERN_IN_SOURCE` fire for every non-factory file in the
 * scan, and `EXCLUDED_BY_CONFIG` is deliberate — none of those indicate a problem.
 */
import {
  IocDiscoverySkipReason,
  IocDiscoveryStatus,
  type IocDiscoveryAnalysisFiles,
} from "./discoverFactories/discoveryOutcomeTypes.js";

const UNUSABLE_EXPORT_SKIP_REASONS: ReadonlySet<IocDiscoverySkipReason> =
  new Set([
    IocDiscoverySkipReason.INVALID_FACTORY_SIGNATURE,
    IocDiscoverySkipReason.CONTRACT_NOT_FOUND,
    IocDiscoverySkipReason.CONTRACT_NOT_IMPORTED,
    IocDiscoverySkipReason.CONTRACT_NOT_RESOLVED,
    IocDiscoverySkipReason.UNSUPPORTED_PATTERN,
  ]);

type UnusableExport = {
  modulePath: string;
  exportName: string;
  skipReason: IocDiscoverySkipReason;
};

const collectUnusableExports = (
  discoveryFiles: IocDiscoveryAnalysisFiles,
): UnusableExport[] => {
  const unusable: UnusableExport[] = [];

  for (const file of discoveryFiles) {
    for (const outcome of file.outcomes) {
      if (
        outcome.scope === "export" &&
        outcome.status === IocDiscoveryStatus.SKIPPED &&
        UNUSABLE_EXPORT_SKIP_REASONS.has(outcome.skipReason)
      ) {
        unusable.push({
          modulePath: file.modulePath,
          exportName: outcome.exportName,
          skipReason: outcome.skipReason,
        });
      }
    }
  }

  return unusable;
};

const formatUnusableExportLine = (entry: UnusableExport): string => {
  const hint =
    entry.skipReason === IocDiscoverySkipReason.CONTRACT_NOT_RESOLVED
      ? " — a bare union return annotation is the common cause; give each implementation its own contract interface extending its union arm"
      : "";
  return `  - ${entry.modulePath} export "${entry.exportName}": ${entry.skipReason}${hint}`;
};

const formatUnusableFactoryExportsWarning = (
  unusable: readonly UnusableExport[],
): string =>
  [
    `[ioc] ${unusable.length} export(s) matched the factory prefix but could not be used as factories:`,
    ...unusable.map((entry) => formatUnusableExportLine(entry)),
    "Run `ioc --discovery` for the full per-export skip list.",
  ].join("\n");

/**
 * Warns (never throws) once, as a single block, when any export-scoped discovery outcome was
 * skipped for a reason meaning "matched the factory prefix but unusable". No-op when discovery
 * records are absent or nothing qualifies.
 */
export const warnUnusableFactoryExports = (
  discoveryFiles: IocDiscoveryAnalysisFiles,
): void => {
  const unusable = collectUnusableExports(discoveryFiles);
  if (unusable.length === 0) {
    return;
  }

  console.warn(formatUnusableFactoryExportsWarning(unusable));
};
