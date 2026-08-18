/**
 * @fileoverview Generation-time warnings for exports that matched — or nearly matched — a
 * registration-unit trigger but produced no registration. Discovery records these skips into
 * per-file outcomes, but until generation surfaced them the only consumer was the on-demand
 * `ioc --discovery` report, so a unit silently dropped (e.g. a bare-union return annotation)
 * produced a successful generation with a hole in the registry. This summary makes every such
 * export visible during `generate` itself.
 *
 * Only export-scoped skips whose reason means "should probably have been a registration" warn.
 * `NO_MATCHING_EXPORT` and `NO_FACTORY_PATTERN_IN_SOURCE` fire for every non-unit file in the scan,
 * and `EXCLUDED_BY_CONFIG` is deliberate — none of those indicate a problem. The class-unit hard
 * errors (multiple `implements`, non-injectable constructor) abort discovery instead and never
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

type SkippedExport = {
  modulePath: string;
  exportName: string;
  skipReason: IocDiscoverySkipReason;
  contractName?: string;
  baseClassName?: string;
};

const collectExports = (
  discoveryFiles: IocDiscoveryAnalysisFiles,
  reasons: ReadonlySet<IocDiscoverySkipReason>,
): SkippedExport[] => {
  const unusable: SkippedExport[] = [];

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
          ...(outcome.contractName !== undefined
            ? { contractName: outcome.contractName }
            : {}),
          ...(outcome.baseClassName !== undefined
            ? { baseClassName: outcome.baseClassName }
            : {}),
        });
      }
    }
  }

  return unusable;
};

/**
 * Contracts that a concrete class in this scan actually registered. An abstract base declaring one
 * of these is doing its job, so it must not warn.
 */
const contractsRegisteredByConcreteClasses = (
  discoveryFiles: IocDiscoveryAnalysisFiles,
): ReadonlySet<string> => {
  const registered = new Set<string>();
  for (const file of discoveryFiles) {
    for (const outcome of file.outcomes) {
      if (
        outcome.scope === "export" &&
        outcome.status === IocDiscoveryStatus.DISCOVERED &&
        outcome.discoveredBy === "implements"
      ) {
        registered.add(outcome.contractName);
      }
    }
  }
  return registered;
};

const formatUnusableExportLine = (entry: SkippedExport): string => {
  const hint =
    entry.skipReason === IocDiscoverySkipReason.CONTRACT_NOT_RESOLVED
      ? " — the contract site (factory return annotation or class `implements` entry) must be a single named type (interface or type alias); primitives, arrays, and inline types cannot be contracts"
      : "";
  return `  - ${entry.modulePath} export "${entry.exportName}": ${entry.skipReason}${hint}`;
};

const formatUnusableFactoryExportsWarning = (
  unusable: readonly SkippedExport[],
): string =>
  [
    `[ioc] ${unusable.length} export(s) matched a registration-unit trigger but could not be used:`,
    ...unusable.map((entry) => formatUnusableExportLine(entry)),
    "Run `ioc --discovery` for the full per-export skip list.",
  ].join("\n");

const formatUnregisteredAbstractContractsWarning = (
  skipped: readonly SkippedExport[],
): string =>
  [
    `[ioc] ${skipped.length} abstract class(es) declare a contract that no concrete class registers:`,
    ...skipped.map(
      (entry) =>
        `  - ${entry.modulePath} class "${entry.exportName}"${
          entry.contractName !== undefined
            ? ` declares \`implements ${entry.contractName}\`, and no concrete class in scan range registers ${entry.contractName}`
            : ""
        }`,
    ),
    "Abstract classes cannot be constructed, so they are never registration units. If a concrete subclass was meant to register, add `implements` to that subclass — inheriting the clause is not enough. If the contract is supplied by a factory or from another package instead, nothing needs to change here.",
  ].join("\n");

const formatInheritedContractWarning = (
  nearMisses: readonly SkippedExport[],
): string =>
  [
    `[ioc] ${nearMisses.length} concrete class(es) inherit a contract but declare no \`implements\`, so they were NOT registered:`,
    ...nearMisses.map((entry) => {
      const base = entry.baseClassName ?? "its base class";
      const contract = entry.contractName ?? "the base's contract";
      return `  - ${entry.modulePath} class "${entry.exportName}" extends ${base}, which declares \`implements ${contract}\`. Add \`implements ${contract}\` to ${entry.exportName} to register it.`;
    }),
    "The registration trigger is local and explicit by design: a class registers because of the `implements` clause it declares itself, never one it inherits. Restating the contract on each concrete class is what keeps \"is this registered?\" answerable at the class, without following a heritage chain across files. If these classes are deliberately unregistered, nothing needs to change.",
  ].join("\n");

/**
 * Warns (never throws) once per category, as a single block each. No-op when discovery records are
 * absent or nothing qualifies.
 */
export const warnUnusableFactoryExports = (
  discoveryFiles: IocDiscoveryAnalysisFiles,
): void => {
  const unusable = collectExports(discoveryFiles, UNUSABLE_EXPORT_SKIP_REASONS);
  if (unusable.length > 0) {
    console.warn(formatUnusableFactoryExportsWarning(unusable));
  }

  /**
   * `abstract class Base implements Contract` is the documented base-class pattern, so warning on
   * every occurrence trained users to ignore the warning. It fires only when the registration is
   * genuinely missing: no concrete class in scan range declares `implements` for that contract.
   */
  const registeredContracts = contractsRegisteredByConcreteClasses(discoveryFiles);
  const unregisteredAbstract = collectExports(
    discoveryFiles,
    new Set([IocDiscoverySkipReason.CLASS_ABSTRACT]),
  ).filter(
    (entry) =>
      entry.contractName === undefined ||
      !registeredContracts.has(entry.contractName),
  );
  if (unregisteredAbstract.length > 0) {
    console.warn(formatUnregisteredAbstractContractsWarning(unregisteredAbstract));
  }

  const inheritedContractNearMisses = collectExports(
    discoveryFiles,
    new Set([IocDiscoverySkipReason.CLASS_INHERITED_CONTRACT_NOT_DECLARED]),
  );
  if (inheritedContractNearMisses.length > 0) {
    console.warn(formatInheritedContractWarning(inheritedContractNearMisses));
  }
};
