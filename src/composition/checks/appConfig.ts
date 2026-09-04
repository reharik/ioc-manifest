import {
  IOC_CONTRACT_CONFIG_KEY,
  type IocConfig,
} from "../../config/iocConfig.js";
import { LOCAL_PACKAGE_IDENTIFIER } from "../../config/packageIdentifier.js";
import { nearestName } from "../../diagnostics/nearestName.js";
import type {
  CompositionContext,
  ParsedImplementationMeta,
  ValidationIssue,
} from "../types.js";

const sortedList = (names: Iterable<string>): string =>
  [...names].sort((a, b) => a.localeCompare(b)).join(", ") || "(none)";

/** The composed package that supplies one implementation, and the unit as its manifest states it. */
type ComposedSupplyOwner = {
  readonly sourceId: string;
  readonly packageLabel: string;
  readonly meta: ParsedImplementationMeta;
};

/**
 * Who supplies each `(contract, implementation)` pair the config can address.
 *
 * Slice 0 is this package; every later slice is a composed manifest. That ordering is the whole
 * definition — a `registrations` entry is addressed to a unit this package DISCOVERS or to one a
 * library already registered, and which of the two it is decides whether the entry's fields have
 * anything to act on.
 *
 * Local wins a name collision, deliberately. When both this package and a library declare the same
 * implementation name under a contract, `registrations` merges onto the locally discovered factory
 * (`resolveRegistrationPlan.mergeContractOverrides`), so the entry IS about a local unit and the
 * local-only fields do exactly what they say. Only a name this package does not discover at all is
 * composed-supplied.
 */
export type ConfigSupplyIndex = {
  readonly local: ReadonlyMap<string, ReadonlySet<string>>;
  readonly composed: ReadonlyMap<
    string,
    ReadonlyMap<string, ComposedSupplyOwner>
  >;
};

export const buildConfigSupplyIndex = (
  ctx: CompositionContext,
): ConfigSupplyIndex => {
  const local = new Map<string, Set<string>>();
  for (const [contractName, impls] of Object.entries(
    ctx.slices[0]?.contracts ?? {},
  )) {
    local.set(contractName, new Set(Object.keys(impls)));
  }

  const composed = new Map<string, Map<string, ComposedSupplyOwner>>();
  for (const slice of ctx.slices.slice(1)) {
    for (const [contractName, impls] of Object.entries(slice.contracts)) {
      let byImpl = composed.get(contractName);
      if (byImpl === undefined) {
        byImpl = new Map();
        composed.set(contractName, byImpl);
      }
      for (const [implementationName, meta] of Object.entries(impls)) {
        // First declarer wins, matching the slice order every other composed reader walks.
        if (!byImpl.has(implementationName)) {
          byImpl.set(implementationName, {
            sourceId: slice.sourceId,
            packageLabel: slice.packageLabel,
            meta,
          });
        }
      }
    }
  }

  return { local, composed };
};

/**
 * The composed package that supplies `(contract, implementation)`, or `undefined` when this package
 * discovers it (or when nothing supplies it at all — that is the unknown-implementation finding,
 * not this one).
 */
export const composedSupplierFor = (
  index: ConfigSupplyIndex,
  contractName: string,
  implementationName: string,
): ComposedSupplyOwner | undefined => {
  if (index.local.get(contractName)?.has(implementationName) === true) {
    return undefined;
  }
  return index.composed.get(contractName)?.get(implementationName);
};

/**
 * The per-implementation fields that only ever act on a unit this package discovers.
 *
 * `default` and `source` are absent on purpose: they are statements about COMPOSITION — which
 * implementation wins the contract's slot, which manifest wins a same-key conflict — and an app
 * making them about a library's unit is the reason those fields exist.
 *
 * `allowLifetimeInversion` is absent too, and that is not an oversight. The scope-root subtree walk
 * ranks composed units for inversion exactly as it ranks local ones, and reaches this same opt-out
 * through the same `(contract, implementation)` pair — see `inversionSuppressedForEdge` in
 * `generator/verifyScopeRoots.ts`. It has real cross-package meaning and stays legal.
 */
const LOCAL_ONLY_IMPLEMENTATION_FIELDS = ["lifetime", "name"] as const;

const lifetimeIssue = (
  contractName: string,
  implementationName: string,
  owner: ComposedSupplyOwner,
): ValidationIssue => {
  const declared = owner.meta.lifetime;
  const at = `registrations[${JSON.stringify(contractName)}][${JSON.stringify(implementationName)}].lifetime`;
  return {
    category: "app-config",
    severity: "error",
    summary: `${at} cannot be set here — ${JSON.stringify(implementationName)} is supplied by composed package ${JSON.stringify(owner.packageLabel)}, not discovered in this package.`,
    details: [
      `The lifetime belongs to the package that owns the unit. ${owner.packageLabel} declares ${contractName}.${implementationName} as ${declared ?? "(lifetime not stated by its manifest)"}.`,
      `A ${JSON.stringify("scoped")} registration is not a caching decision made on your behalf: Awilix caches it on whatever container it was resolved from, with no chaining to the parent. Resolving from the root container gives one instance per process; resolving inside a request scope gives one per request. Two apps get two different world sizes out of the same registration, and neither overrules the package.`,
      `Overriding to ${JSON.stringify("singleton")} does not adjust that knob — it removes it, replacing "the app decides how big a world is" with "there is exactly one, forever". The dangerous direction is also the silent one: a scoped consumer depending on a now-singleton dependency is not a lifetime inversion, so strict mode does not throw and no edge-based check can see it.`,
    ],
    suggestedFix: `Remove ${at}. For a longer-lived instance, resolve ${JSON.stringify(owner.meta.registrationKey)} from the root container; for a shorter-lived one, resolve it inside a scope. If ${owner.packageLabel}'s declared lifetime is genuinely wrong for every consumer, that is a change to ${owner.packageLabel}, not to this config.`,
    packages: [LOCAL_PACKAGE_IDENTIFIER, owner.sourceId],
  };
};

const localOnlyFieldIssue = (
  field: string,
  contractName: string,
  implementationName: string,
  owner: ComposedSupplyOwner,
): ValidationIssue => {
  const at = `registrations[${JSON.stringify(contractName)}][${JSON.stringify(implementationName)}].${field}`;
  return {
    category: "app-config",
    severity: "error",
    summary: `${at} cannot be set here — ${JSON.stringify(implementationName)} is supplied by composed package ${JSON.stringify(owner.packageLabel)}, not discovered in this package.`,
    details: [
      `${field} applies only to units this package discovers; it is read while planning local registrations and there is nothing here to apply it to.`,
      `${owner.packageLabel} owns ${contractName}.${implementationName} and registers it as ${JSON.stringify(owner.meta.registrationKey)}.`,
    ],
    suggestedFix: `Remove ${at}. Across packages, ${JSON.stringify("default")} elects this implementation for the contract and ${JSON.stringify("source")} settles a same-key conflict; the registration key itself belongs to ${owner.packageLabel}.`,
    packages: [LOCAL_PACKAGE_IDENTIFIER, owner.sourceId],
  };
};

const contractAccessKeyIssue = (
  contractName: string,
  owners: readonly ComposedSupplyOwner[],
): ValidationIssue => {
  const labels = [...new Set(owners.map((o) => o.packageLabel))].sort((a, b) =>
    a.localeCompare(b),
  );
  const at = `registrations[${JSON.stringify(contractName)}][${JSON.stringify(IOC_CONTRACT_CONFIG_KEY)}].accessKey`;
  return {
    category: "app-config",
    severity: "error",
    summary: `${at} cannot be set here — every implementation of ${JSON.stringify(contractName)} is supplied by ${labels.map((l) => JSON.stringify(l)).join(", ")}, and none is discovered in this package.`,
    details: [
      `accessKey names the contract's default slot on the cradle, and it is resolved only for contracts this package discovers implementations for. Set on a contract that is entirely composed, it is read and then dropped.`,
      `The slot key for ${contractName} belongs to ${labels.join(", ")}.`,
    ],
    suggestedFix: `Remove ${at}. If the slot key is wrong for every consumer, change it in ${labels.join(", ")}.`,
    packages: [
      LOCAL_PACKAGE_IDENTIFIER,
      ...new Set(owners.map((o) => o.sourceId)),
    ],
  };
};

const unknownImplementationIssue = (
  contractName: string,
  implementationName: string,
  index: ConfigSupplyIndex,
  everySlice: readonly string[],
): ValidationIssue => {
  const localImpls = index.local.get(contractName) ?? new Set<string>();
  const composedImpls = index.composed.get(contractName) ?? new Map();
  const composedList =
    [...composedImpls.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, owner]) => `${name} (${owner.packageLabel})`)
      .join(", ") || "(none)";
  const details = [
    `Local implementations of ${contractName}: ${sortedList(localImpls)}.`,
    `Composed implementations of ${contractName}: ${composedList}.`,
  ];
  const suggestion = nearestName(implementationName, [
    ...localImpls,
    ...composedImpls.keys(),
  ]);
  if (suggestion !== undefined) {
    details.push(`Did you mean: ${JSON.stringify(suggestion)}?`);
  }
  return {
    category: "app-config",
    severity: "error",
    summary: `registrations[${JSON.stringify(contractName)}] references unknown implementation ${JSON.stringify(implementationName)}`,
    details,
    suggestedFix: `Fix the implementation name in ioc.config.ts, or add a factory implementing ${JSON.stringify(contractName)} under that name.`,
    packages: everySlice,
  };
};

export const checkAppConfigSanity = (
  config: IocConfig,
  ctx: CompositionContext,
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const composedSet = new Set(ctx.composedPackageNames);
  /**
   * Two of the three complaints below are "the config names something no manifest declares", and
   * the KNOWN set is a union read out of every slice. So they rest on every package's artifacts:
   * a name that looks unknown may simply be one a stale manifest has not caught up to declaring.
   *
   * The third — a `source` naming a package that is not in `composedManifests` — is config against
   * config, reads no manifest, and is attributed to nothing. That absence is the point of the
   * field being optional.
   */
  const everySlice = ctx.slices.map((slice) => slice.sourceId);
  const allContracts = new Set([
    ...ctx.localContractNames,
    ...ctx.composedContractNames,
  ]);
  const candidates = [...allContracts];
  const supply = buildConfigSupplyIndex(ctx);

  if (config.registrations !== undefined) {
    for (const contract of Object.keys(config.registrations)) {
      if (allContracts.has(contract)) {
        continue;
      }
      const suggestion = nearestName(contract, candidates);
      const details = [
        `Known local contracts: ${[...ctx.localContractNames].sort((a, b) => a.localeCompare(b)).join(", ") || "(none)"}.`,
        `Known composed contracts: ${[...ctx.composedContractNames].sort((a, b) => a.localeCompare(b)).join(", ") || "(none)"}.`,
      ];
      if (suggestion !== undefined) {
        details.push(`Did you mean: ${JSON.stringify(suggestion)}?`);
      }
      issues.push({
        category: "app-config",
        severity: "error",
        summary: `registrations references unknown contract ${JSON.stringify(contract)}`,
        details,
        suggestedFix: `Fix the contract name in ioc.config.ts registrations, or add a factory for ${JSON.stringify(contract)}.`,
        packages: everySlice,
      });
    }

    for (const [contractName, perContract] of Object.entries(
      config.registrations,
    )) {
      if (typeof perContract !== "object" || perContract === null) {
        continue;
      }
      /**
       * The contract-level slot key, refused when nothing local backs the contract.
       *
       * Same shape as the per-implementation refusals below and the same reason, one level up:
       * `resolveRegistrationPlan` resolves an access key per contract in the LOCALLY merged map, so
       * on a wholly composed contract this field is parsed, validated, and then never read.
       */
      const contractLevel = perContract[IOC_CONTRACT_CONFIG_KEY];
      if (
        typeof contractLevel === "object" &&
        contractLevel !== null &&
        (contractLevel as { accessKey?: unknown }).accessKey !== undefined
      ) {
        const localImpls = supply.local.get(contractName);
        const composedImpls = supply.composed.get(contractName);
        if (
          (localImpls === undefined || localImpls.size === 0) &&
          composedImpls !== undefined &&
          composedImpls.size > 0
        ) {
          issues.push(
            contractAccessKeyIssue(contractName, [...composedImpls.values()]),
          );
        }
      }

      for (const [implementationName, override] of Object.entries(
        perContract,
      )) {
        if (implementationName === IOC_CONTRACT_CONFIG_KEY) {
          continue;
        }
        if (typeof override !== "object" || override === null) {
          continue;
        }

        /**
         * An implementation name matching nothing, under a contract that DOES exist.
         *
         * The unknown-CONTRACT complaint above already covers the other half, and reporting this
         * one under a contract that is itself unknown would be a second sentence about the same
         * typo — so it runs only once the contract is known.
         */
        if (allContracts.has(contractName)) {
          const knownLocally =
            supply.local.get(contractName)?.has(implementationName) === true;
          const knownComposed =
            supply.composed.get(contractName)?.has(implementationName) === true;
          if (!knownLocally && !knownComposed) {
            issues.push(
              unknownImplementationIssue(
                contractName,
                implementationName,
                supply,
                everySlice,
              ),
            );
            continue;
          }
        }

        /**
         * Fields with no cross-package meaning, set on a unit another package owns.
         *
         * They parse, they survive the contract-name check (which accepts composed contracts on
         * purpose), and then `buildComposedRegistrationOverridesFromConfig` reads only `default`
         * and `source` — so the rest were dropped in silence and the container ignored the config.
         * Refused rather than validated: see {@link lifetimeIssue} for why the lifetime one in
         * particular cannot be made to work by checking it harder.
         */
        const owner = composedSupplierFor(
          supply,
          contractName,
          implementationName,
        );
        if (owner !== undefined) {
          for (const field of LOCAL_ONLY_IMPLEMENTATION_FIELDS) {
            if ((override as Record<string, unknown>)[field] === undefined) {
              continue;
            }
            issues.push(
              field === "lifetime"
                ? lifetimeIssue(contractName, implementationName, owner)
                : localOnlyFieldIssue(
                    field,
                    contractName,
                    implementationName,
                    owner,
                  ),
            );
          }
        }

        if (!("source" in override)) {
          continue;
        }
        const source = (override as { source?: unknown }).source;
        if (typeof source !== "string") {
          continue;
        }
        if (source === "local") {
          continue;
        }
        if (!composedSet.has(source)) {
          issues.push({
            category: "app-config",
            severity: "error",
            summary: `registrations.${contractName}.${implementationName}.source references unknown package ${JSON.stringify(source)}`,
            details: [
              `composedManifests: ${[...composedSet].map((p) => JSON.stringify(p)).join(", ") || "(none)"}`,
            ],
            suggestedFix: `Use "local" or one of the package names listed in composedManifests.`,
          });
        }
      }
    }
  }

  const aliases = config.groupBaseTypeAliases;
  if (aliases !== undefined) {
    for (const groupName of Object.keys(aliases)) {
      if (!ctx.declaredGroupNames.has(groupName)) {
        issues.push({
          category: "app-config",
          severity: "error",
          summary: `groupBaseTypeAliases references unknown group ${JSON.stringify(groupName)}`,
          details: [
            `Declared groups: ${[...ctx.declaredGroupNames].sort((a, b) => a.localeCompare(b)).join(", ") || "(none)"}`,
          ],
          suggestedFix:
            "Remove the alias entry or declare the group in this app or a composed package.",
          packages: everySlice,
        });
      }
    }
  }

  return issues;
};
