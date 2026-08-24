import {
  getImplOverrideForImplementation,
  type IocConfig,
  type IocLifetime,
} from "../config/iocConfig.js";
import {
  docsPointerLine,
  docsPointerSuffix,
} from "../diagnostics/errorDocs.js";
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
): boolean => LIFETIME_RANK[depLifetime] < LIFETIME_RANK[consumerLifetime];

/** Exported for the scope-root subgraph walk, which ranks the same pairs from its own consumers. */
export const inversionSeverity = (
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

/** The printed code for this family — the grep handle, and the key its docs pointer resolves under. */
export const LIFETIME_INVERSION_CODE = "lifetime-inversion";

/**
 * One offender, in the second register only: which unit, which dependency, which lifetimes, and
 * what that combination does at runtime.
 *
 * The rule ("a unit lives at most as long as its shortest-lived dependency") is stated once in the
 * preamble and articulated on the linked page; the fix is stated once at the end. Repeating either
 * on every offender is what made a five-inversion run unreadable.
 */
const formatInversionMessage = (inv: LifetimeInversion): string => {
  const via = inv.via.startsWith("group:")
    ? ` via group '${inv.via.slice("group:".length)}' member '${inv.memberKey ?? inv.depKey}'`
    : "";
  const consequence =
    inv.severity === "error"
      ? "a singleton freezes its scoped dependency at first construction and reuses it across every scope"
      : "a longer-lived consumer holding a shorter-lived dependency keeps the first instance it was given";

  return (
    `[${LIFETIME_INVERSION_CODE}] '${inv.consumerKey}' (${inv.consumerLifetime})` +
    ` depends on ${formatDepPhrase(inv)}${via} — ${consequence}.`
  );
};

/**
 * Appended to WARNED inversions only, where the static severity and the runtime's disagree.
 *
 * `singleton → transient` and `scoped → transient` are warnings here and errors in Awilix strict
 * mode, which `registerIocFromManifest` turns on by default. Naming the consequence where the
 * warning fires is the whole point: a warning the reader is entitled to skim, whose actual effect
 * is a crash at first resolve, is a warning that lied. (The `singleton → scoped` ERROR needs no such
 * line — generation refuses, so no runtime is reached.)
 */
export const STRICT_RUNTIME_CONSEQUENCE =
  " Under the default runtime this edge throws at first resolve:" +
  " `registerIocFromManifest` enables Awilix strict mode unless you pass `{ strict: false }`," +
  " and `allowLifetimeInversion` suppresses this report only — it is not a runtime exemption.";

/** Stated once, at the end, for however many offenders the run found. */
const INVERSION_FIX_LINE =
  "Fix by registering the consumer at the shorter lifetime, or mark an inversion intentional with " +
  "registrations[<Contract>].<impl>.allowLifetimeInversion in ioc.config.";

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

/**
 * `allowLifetimeInversion` suppression for one (unit, dep key) pair. Exported so the scope-root
 * subgraph walk honours the same opt-out rather than inventing a second one.
 *
 * Takes only the (contract, implementation) pair the override is addressed by, not a whole
 * `DiscoveredFactory`: the scope-root walk also ranks units carried in by composed manifests, which
 * are not discovered factories and have no source file here, and they must reach the same opt-out.
 */
export const isLifetimeInversionSuppressed = (
  factory: Pick<DiscoveredFactory, "contractName" | "implementationName">,
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
      if (isLifetimeInversionSuppressed(factory, depKey, config)) {
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
    // A warning is printed alone, so it carries its own pointer; the aggregated error carries one
    // pointer for the whole list instead of repeating it per offender.
    console.warn(
      `[ioc] ${formatInversionMessage(inv)}${STRICT_RUNTIME_CONSEQUENCE}` +
        `${docsPointerSuffix(LIFETIME_INVERSION_CODE)}`,
    );
  }

  const errors = inversions.filter((inv) => inv.severity === "error");
  if (errors.length === 0) {
    return;
  }

  const docsLine = docsPointerLine(LIFETIME_INVERSION_CODE);
  throw new Error(
    [
      `[ioc] ${errors.length} lifetime inversion${errors.length === 1 ? "" : "s"}.` +
        " A unit lives at most as long as its shortest-lived dependency, and these outlive theirs:",
      ...(docsLine !== undefined ? [docsLine] : []),
      ...errors.map((inv) => `  - ${formatInversionMessage(inv)}`),
      INVERSION_FIX_LINE,
    ].join("\n"),
  );
};
