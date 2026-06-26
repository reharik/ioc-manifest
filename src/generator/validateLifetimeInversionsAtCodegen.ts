import {
  getImplOverrideForImplementation,
  type IocConfig,
  type IocLifetime,
} from "../config/iocConfig.js";
import type { IocGroupsManifest } from "../core/manifest.js";
import type { DemandSupplyAnalysisResult } from "./analyzeDemandSupply/index.js";
import type { ResolvedContractRegistration } from "./resolveRegistrationPlan.js";
import type { DiscoveredFactory } from "./types.js";

const LIFETIME_RANK: Record<IocLifetime, number> = {
  singleton: 3,
  scoped: 2,
  transient: 1,
};

type InversionVia = "direct" | `group:${string}` | "scope-provided";

type LifetimeInversion = {
  consumerKey: string;
  consumerLifetime: IocLifetime;
  depKey: string;
  depLifetime: IocLifetime;
  via: InversionVia;
  memberKey?: string;
  severity: "error" | "warn";
};

type DepCandidate = {
  depLifetime: IocLifetime;
  via: InversionVia;
  memberKey?: string;
};

const isInversion = (
  consumerLifetime: IocLifetime,
  depLifetime: IocLifetime,
): boolean =>
  LIFETIME_RANK[depLifetime] < LIFETIME_RANK[consumerLifetime];

const inversionSeverity = (
  consumerLifetime: IocLifetime,
  depLifetime: IocLifetime,
): "error" | "warn" | undefined => {
  if (!isInversion(consumerLifetime, depLifetime)) {
    return undefined;
  }
  if (consumerLifetime === "singleton" && depLifetime === "scoped") {
    return "error";
  }
  return "warn";
};

const formatDepPhrase = (inv: LifetimeInversion): string => {
  if (inv.via === "scope-provided") {
    return `'${inv.depKey}' (scope-provided, per-request)`;
  }
  if (inv.via.startsWith("group:") && inv.memberKey !== undefined) {
    return `'${inv.memberKey}' (${inv.depLifetime})`;
  }
  return `'${inv.depKey}' (${inv.depLifetime})`;
};

const formatInversionMessage = (inv: LifetimeInversion): string => {
  const depPhrase = formatDepPhrase(inv);
  let message =
    `Lifetime inversion: '${inv.consumerKey}' (${inv.consumerLifetime}) depends on ${depPhrase}.`;

  if (inv.severity === "error") {
    message +=
      " A singleton freezes its scoped dependency at first construction, reusing it across all scopes.";
  } else {
    message +=
      " A longer-lived consumer should not depend on a shorter-lived dependency.";
  }

  message += ` Register '${inv.consumerKey}' as scoped (or shorter), or mark it intentional with registrations['<Contract>'].<impl>.allowLifetimeInversion.`;

  if (inv.via.startsWith("group:")) {
    const groupKey = inv.via.slice("group:".length);
    message += ` via group '${groupKey}' member '${inv.memberKey ?? inv.depKey}'.`;
  }

  return message;
};

const collectGroupMemberLeaves = (
  manifest: IocGroupsManifest[string],
): { memberKey: string; registrationKey: string }[] => {
  if (Array.isArray(manifest.members)) {
    return manifest.members.map((member) => ({
      memberKey: member.registrationKey,
      registrationKey: member.registrationKey,
    }));
  }
  return Object.entries(manifest.members).map(([memberKey, leaf]) => ({
    memberKey,
    registrationKey: leaf.registrationKey,
  }));
};

const buildLifetimeLookups = (
  plans: readonly ResolvedContractRegistration[],
): {
  regLifetime: Map<string, IocLifetime>;
  accessKeyToDefaultLifetime: Map<string, IocLifetime>;
} => {
  const regLifetime = new Map<string, IocLifetime>();
  const accessKeyToDefaultLifetime = new Map<string, IocLifetime>();

  for (const plan of plans) {
    for (const impl of plan.implementations) {
      regLifetime.set(impl.registrationKey, impl.lifetime);
    }

    const defaultImpl = plan.implementations.find(
      (impl) => impl.implementationName === plan.defaultImplementationName,
    );
    if (defaultImpl !== undefined) {
      accessKeyToDefaultLifetime.set(plan.accessKey, defaultImpl.lifetime);
    }
  }

  return { regLifetime, accessKeyToDefaultLifetime };
};

const resolveDepCandidates = (
  key: string,
  regLifetime: Map<string, IocLifetime>,
  accessKeyToDefaultLifetime: Map<string, IocLifetime>,
  groupsManifest: IocGroupsManifest | undefined,
  externalKeys: ReadonlySet<string>,
  scopeProvidedKeys: ReadonlySet<string>,
): DepCandidate[] | "skip" => {
  if (externalKeys.has(key)) {
    return "skip";
  }

  if (scopeProvidedKeys.has(key)) {
    return [{ depLifetime: "scoped", via: "scope-provided" }];
  }

  const groupRoot = groupsManifest?.[key];
  if (groupRoot !== undefined) {
    const candidates: DepCandidate[] = [];
    for (const member of collectGroupMemberLeaves(groupRoot)) {
      const depLifetime = regLifetime.get(member.registrationKey);
      if (depLifetime === undefined) {
        continue;
      }
      candidates.push({
        depLifetime,
        via: `group:${key}`,
        memberKey: member.memberKey,
      });
    }
    return candidates.length > 0 ? candidates : "skip";
  }

  const directLifetime = regLifetime.get(key);
  if (directLifetime !== undefined) {
    return [{ depLifetime: directLifetime, via: "direct" }];
  }

  const accessLifetime = accessKeyToDefaultLifetime.get(key);
  if (accessLifetime !== undefined) {
    return [{ depLifetime: accessLifetime, via: "direct" }];
  }

  return "skip";
};

const isSuppressed = (
  factory: DiscoveredFactory,
  depKey: string,
  config: IocConfig | undefined,
): boolean => {
  const allow = getImplOverrideForImplementation(
    config?.registrations?.[factory.contractName],
    factory.implementationName,
  )?.allowLifetimeInversion;

  if (allow === true) {
    return true;
  }
  if (Array.isArray(allow)) {
    return allow.includes(depKey);
  }
  return false;
};

/**
 * Generation-time lifetime-inversion checks using factory `dependencyKeys` and resolved plan lifetimes.
 */
export const validateLifetimeInversionsAtCodegen = (
  acceptedFactories: readonly DiscoveredFactory[],
  plans: readonly ResolvedContractRegistration[],
  groupsManifest: IocGroupsManifest | undefined,
  demandSupply: DemandSupplyAnalysisResult,
  config: IocConfig | undefined,
): void => {
  const { regLifetime, accessKeyToDefaultLifetime } =
    buildLifetimeLookups(plans);
  const externalKeys = new Set(demandSupply.externalKeys);
  const scopeProvidedKeys = new Set(demandSupply.scopeProvidedKeys);
  const inversions: LifetimeInversion[] = [];

  for (const factory of acceptedFactories) {
    const consumerLifetime = regLifetime.get(factory.registrationKey);
    if (consumerLifetime === undefined) {
      continue;
    }

    const dependencyKeys = factory.dependencyKeys;
    if (dependencyKeys === undefined || dependencyKeys.length === 0) {
      continue;
    }

    for (const depKey of dependencyKeys) {
      if (isSuppressed(factory, depKey, config)) {
        continue;
      }

      const resolved = resolveDepCandidates(
        depKey,
        regLifetime,
        accessKeyToDefaultLifetime,
        groupsManifest,
        externalKeys,
        scopeProvidedKeys,
      );
      if (resolved === "skip") {
        continue;
      }

      for (const candidate of resolved) {
        const severity = inversionSeverity(
          consumerLifetime,
          candidate.depLifetime,
        );
        if (severity === undefined) {
          continue;
        }

        inversions.push({
          consumerKey: factory.registrationKey,
          consumerLifetime,
          depKey,
          depLifetime: candidate.depLifetime,
          via: candidate.via,
          memberKey: candidate.memberKey,
          severity,
        });
      }
    }
  }

  for (const inv of inversions) {
    if (inv.severity !== "warn") {
      continue;
    }
    console.warn(`[ioc] ${formatInversionMessage(inv)}`);
  }

  const errors = inversions.filter((inv) => inv.severity === "error");
  if (errors.length === 0) {
    return;
  }

  throw new Error(
    `${errors.map(formatInversionMessage).join("\n")}\n` +
      "Suppress intentionally with registrations[ContractName].implementationName.allowLifetimeInversion in ioc.config.",
  );
};
