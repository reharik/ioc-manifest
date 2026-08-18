/**
 * @fileoverview Generation-time warning for exports that matched a registration-unit trigger but
 * could not be turned into registrations. Discovery records these skips into per-file outcomes, but
 * until generation surfaced them the only consumer was the on-demand `ioc --discovery` report — so
 * a unit silently dropped (e.g. a bare-union return annotation) produced a successful generation
 * with a hole in the registry. This summary makes every unusable trigger-matched export visible
 * during `generate` itself.
 *
 * Only export-scoped skips whose reason means "looked like a registration unit, could not be used"
 * warn. `NO_MATCHING_EXPORT` and `NO_FACTORY_PATTERN_IN_SOURCE` fire for every non-unit file in the
 * scan, and `EXCLUDED_BY_CONFIG` is deliberate — none of those indicate a problem. The class-unit
 * hard errors (multiple `implements`, non-injectable constructor) abort discovery instead and never
 * reach here.
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

/**
 * Skipped-but-legitimate class units. An abstract class carrying `implements` is usually a shared
 * base the author never meant to register — but it is also exactly what a user who *did* mean to
 * register it would write, so it warns rather than passing silently.
 */
const SKIPPED_CLASS_UNIT_SKIP_REASONS: ReadonlySet<IocDiscoverySkipReason> =
  new Set([IocDiscoverySkipReason.CLASS_ABSTRACT]);

type UnusableExport = {
  modulePath: string;
  exportName: string;
  skipReason: IocDiscoverySkipReason;
};

const collectExports = (
  discoveryFiles: IocDiscoveryAnalysisFiles,
  reasons: ReadonlySet<IocDiscoverySkipReason>,
): UnusableExport[] => {
  const unusable: UnusableExport[] = [];

  for (const file of discoveryFiles) {
    for (const outcome of file.outcomes) {
      if (
        outcome.scope === "export" &&
        outcome.status === IocDiscoveryStatus.SKIPPED &&
        reasons.has(outcome.skipReason)
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
      ? " — the contract site (factory return annotation or class `implements` entry) must be a single named type (interface or type alias); primitives, arrays, and inline types cannot be contracts"
      : "";
  return `  - ${entry.modulePath} export "${entry.exportName}": ${entry.skipReason}${hint}`;
};

const formatUnusableFactoryExportsWarning = (
  unusable: readonly UnusableExport[],
): string =>
  [
    `[ioc] ${unusable.length} export(s) matched a registration-unit trigger but could not be used:`,
    ...unusable.map((entry) => formatUnusableExportLine(entry)),
    "Run `ioc --discovery` for the full per-export skip list.",
  ].join("\n");

const formatSkippedClassUnitsWarning = (
  skipped: readonly UnusableExport[],
): string =>
  [
    `[ioc] ${skipped.length} abstract class(es) carry an \`implements\` clause and were NOT registered:`,
    ...skipped.map((entry) => `  - ${entry.modulePath} class "${entry.exportName}"`),
    "Abstract classes cannot be constructed, so they are never registration units. If this was meant to be a registration, make the class concrete; if it is a shared base, move `implements` to the concrete subclasses.",
  ].join("\n");

/**
 * Warns (never throws) once per category, as a single block each, when any export-scoped discovery
 * outcome was skipped for a reason meaning "matched a registration-unit trigger but unusable".
 * No-op when discovery records are absent or nothing qualifies.
 */
export const warnUnusableFactoryExports = (
  discoveryFiles: IocDiscoveryAnalysisFiles,
): void => {
  const unusable = collectExports(discoveryFiles, UNUSABLE_EXPORT_SKIP_REASONS);
  if (unusable.length > 0) {
    console.warn(formatUnusableFactoryExportsWarning(unusable));
  }

  const skippedClasses = collectExports(
    discoveryFiles,
    SKIPPED_CLASS_UNIT_SKIP_REASONS,
  );
  if (skippedClasses.length > 0) {
    console.warn(formatSkippedClassUnitsWarning(skippedClasses));
  }
};
