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
import type {
  ComposedGroupRoot,
  ComposedManifestSupply,
  ComposedManifestUnit,
} from "./loadComposedManifestUnits.js";
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
  /** Composed packages the dependency is registered by; absent when it is local. */
  packageNames?: readonly string[];
  severity: "error" | "warn";
};

/**
 * WHY a dependency's lifetime could not be read, in the terms the disclosure prints.
 *
 * The three are not interchangeable. `external` is the one benign answer — the composing app
 * supplies the key at bootstrap and no manifest states a lifetime for it. The other two mean a
 * group root names a member that nothing this run can see registers, which is a fact about the
 * inputs rather than about the graph, and the reader has to be told which.
 */
type UndeterminedOrigin = "external" | "composed-root-only" | "unknown";

type DepCandidate =
  | {
      kind: "ranked";
      depLifetime: IocLifetime;
      via: InversionVia;
      memberKey?: string;
      packageNames?: readonly string[];
    }
  | {
      kind: "undetermined";
      via: InversionVia;
      memberKey: string;
      registrationKey: string;
      origin: UndeterminedOrigin;
    };

/** One (consumer, group member) edge the check reached but could not rank. */
type UndeterminedEdge = {
  consumerKey: string;
  consumerLifetime: IocLifetime;
  depKey: string;
  memberKey: string;
  registrationKey: string;
  origin: UndeterminedOrigin;
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

/**
 * "…, composed package "@acme/lib"" — the half-sentence that says whose file this is.
 *
 * A member the reader cannot open in this repository is the single most useful fact about an
 * offending edge, because the fix (register the consumer shorter, or opt out) is written HERE while
 * the lifetime being complained about is written THERE. A local dependency gets nothing appended:
 * everything unannotated in this report is this package's own.
 */
const composedAttribution = (packageNames?: readonly string[]): string => {
  if (packageNames === undefined || packageNames.length === 0) {
    return "";
  }
  const label =
    packageNames.length === 1 ? "composed package" : "composed packages";
  return `, ${label} ${packageNames.map((name) => JSON.stringify(name)).join(", ")}`;
};

const formatDepPhrase = (inv: LifetimeInversion): string => {
  if (inv.via === "scope-provided") {
    return `'${inv.depKey}' (scope-provided, per-request)`;
  }
  const attribution = composedAttribution(inv.packageNames);
  if (inv.via.startsWith("group:") && inv.memberKey !== undefined) {
    return `'${inv.memberKey}' (${inv.depLifetime}${attribution})`;
  }
  return `'${inv.depKey}' (${inv.depLifetime}${attribution})`;
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

const undeterminedOriginPhrase = (origin: UndeterminedOrigin): string => {
  switch (origin) {
    case "external":
      return "the composing app supplies that key at bootstrap and declares no lifetime for it";
    case "composed-root-only":
      return "a composed group root names it, but no manifest this run read registers it";
    case "unknown":
      return "no local registration and no composed manifest carries it";
  }
};

/**
 * A group member this run reached but could not rank — printed, never swallowed.
 *
 * The check used to `continue` past exactly this case, which is how a composed group's members
 * disappeared from a mixed-member group silently: the group was ranked, some members were ranked,
 * and the ones that were not left no trace. An unranked edge is not a cleared edge, and the only
 * honest thing to print about it is that it was not ranked and why.
 */
const formatUndeterminedMessage = (edge: UndeterminedEdge): string =>
  `[${LIFETIME_INVERSION_CODE}] '${edge.consumerKey}' (${edge.consumerLifetime}) depends on` +
  ` group '${edge.depKey}' member '${edge.memberKey}', whose registration '${edge.registrationKey}'` +
  ` has no lifetime this run can read (${undeterminedOriginPhrase(edge.origin)}) —` +
  " that edge is UNRANKED, not cleared.";

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

/** One group member, in the terms this check ranks it: what to print, and what to look up. */
type GroupMemberRef = {
  memberKey: string;
  registrationKey: string;
  /** Set when the member arrived from a composed root rather than the local group plan. */
  packageNames?: readonly string[];
};

const collectGroupMemberLeaves = (
  manifest: IocGroupsManifest[string],
): GroupMemberRef[] => {
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

/**
 * A composed root's members, spelled the way the diagnostic must print them.
 *
 * `memberProperty` is the record-group property name — what a reader writes after the group key —
 * and it exists nowhere but the manifest's member map. A collection group's members are anonymous
 * by declaration, so their registration key is the only name there is, which is exactly the rule
 * {@link collectGroupMemberLeaves} already follows for local roots.
 */
const collectComposedGroupMembers = (
  root: ComposedGroupRoot,
): GroupMemberRef[] =>
  root.members.map((member) => ({
    memberKey: member.memberProperty ?? member.registrationKey,
    registrationKey: member.registrationKey,
    packageNames: root.packageNames,
  }));

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

/**
 * Everything a dependency key is resolved against, local and composed side by side.
 *
 * Composed supply is not a second-class input here. The lifetime written in a composed manifest is
 * not a guess about what some other package might do — it is the lifetime `composeManifests` will
 * register, in the same container, under the same key. Ranking it is as sound as ranking a local
 * plan's, and the scope-root walk already treats it that way.
 */
type DepResolutionContext = {
  regLifetime: Map<string, IocLifetime>;
  accessKeyToDefaultLifetime: Map<string, IocLifetime>;
  groupsManifest: IocGroupsManifest | undefined;
  composedUnits: ReadonlyMap<string, ComposedManifestUnit>;
  composedGroupRoots: ReadonlyMap<string, ComposedGroupRoot>;
  composedAccessKeys: ReadonlyMap<string, string>;
  externalKeys: ReadonlySet<string>;
  scopeProvidedKeys: ReadonlySet<string>;
};

/**
 * The lifetime registered under one registration key, local first.
 *
 * Local precedence, for the same reason every other layer applies it: a local registration is what
 * discovery actually saw, and a genuine collision between a local key and a composed one is
 * composition's error to raise, not this check's to guess at.
 */
const resolveRegistrationLifetime = (
  registrationKey: string,
  ctx: DepResolutionContext,
): { lifetime: IocLifetime; packageNames?: readonly string[] } | undefined => {
  const local = ctx.regLifetime.get(registrationKey);
  if (local !== undefined) {
    return { lifetime: local };
  }
  const unit = ctx.composedUnits.get(registrationKey);
  if (unit !== undefined) {
    return { lifetime: unit.lifetime, packageNames: [unit.packageName] };
  }
  return undefined;
};

/**
 * Members of the group this key names, or `undefined` when it names no group.
 *
 * Local and composed roots MERGE rather than shadow one another, because that is what
 * `composeManifests` does at runtime: a group key present in both places resolves to the union, and
 * the cradle hands out that union. Merging here is what makes all three composed shapes rankable
 * from one branch — a root only a library declares, a locally-EMPTY root whose members all arrive
 * by composition, and the mixed root that has some of each.
 */
const collectGroupMembers = (
  key: string,
  ctx: DepResolutionContext,
): GroupMemberRef[] | undefined => {
  const localRoot = ctx.groupsManifest?.[key];
  const composedRoot = ctx.composedGroupRoots.get(key);
  if (localRoot === undefined && composedRoot === undefined) {
    return undefined;
  }

  const members: GroupMemberRef[] =
    localRoot === undefined ? [] : collectGroupMemberLeaves(localRoot);
  if (composedRoot !== undefined) {
    for (const member of collectComposedGroupMembers(composedRoot)) {
      if (
        !members.some((seen) => seen.registrationKey === member.registrationKey)
      ) {
        members.push(member);
      }
    }
  }
  return members;
};

/**
 * What one dependency key resolves to, for ranking.
 *
 * `"skip"` means one thing only: the key is supplied by the composing app at bootstrap and no
 * manifest anywhere states a lifetime for it, so there is nothing to rank against. It used to mean
 * something much wider — "supplied by any manifest other than this one" — because the externals
 * gate ran FIRST, before the group branch, and every composed key is external by classification.
 * That gate silently swallowed every consumer → composed-group → member edge in the codebase.
 * Composed supply is therefore consulted before the fall-through, not after it.
 */
const resolveDepCandidates = (
  key: string,
  ctx: DepResolutionContext,
): DepCandidate[] | "skip" => {
  // Ahead of everything, including composed supply: a scope-provided key is registered per-request
  // on the scope by the app, which overrides whatever any manifest registered under that name.
  if (ctx.scopeProvidedKeys.has(key)) {
    return [{ kind: "ranked", depLifetime: "scoped", via: "scope-provided" }];
  }

  const members = collectGroupMembers(key, ctx);
  if (members !== undefined) {
    return members.map((member): DepCandidate => {
      const resolved = resolveRegistrationLifetime(member.registrationKey, ctx);
      if (resolved !== undefined) {
        return {
          kind: "ranked",
          depLifetime: resolved.lifetime,
          via: `group:${key}`,
          memberKey: member.memberKey,
          ...(resolved.packageNames !== undefined
            ? { packageNames: resolved.packageNames }
            : {}),
        };
      }
      return {
        kind: "undetermined",
        via: `group:${key}`,
        memberKey: member.memberKey,
        registrationKey: member.registrationKey,
        origin: ctx.externalKeys.has(member.registrationKey)
          ? "external"
          : member.packageNames !== undefined
            ? "composed-root-only"
            : "unknown",
      };
    });
  }

  const direct = resolveRegistrationLifetime(key, ctx);
  if (direct !== undefined) {
    return [
      {
        kind: "ranked",
        depLifetime: direct.lifetime,
        via: "direct",
        ...(direct.packageNames !== undefined
          ? { packageNames: direct.packageNames }
          : {}),
      },
    ];
  }

  const accessLifetime = ctx.accessKeyToDefaultLifetime.get(key);
  if (accessLifetime !== undefined) {
    return [{ kind: "ranked", depLifetime: accessLifetime, via: "direct" }];
  }

  // A composed contract's default slot, through the alias `registerContractDefaultAliases` will
  // register — the same hop the local `accessKey` branch above makes, on the other side of the
  // package boundary.
  const composedTarget = ctx.composedAccessKeys.get(key);
  if (composedTarget !== undefined) {
    const resolved = resolveRegistrationLifetime(composedTarget, ctx);
    if (resolved !== undefined) {
      return [
        {
          kind: "ranked",
          depLifetime: resolved.lifetime,
          via: "direct",
          ...(resolved.packageNames !== undefined
            ? { packageNames: resolved.packageNames }
            : {}),
        },
      ];
    }
  }

  // Nothing registers this key — in this package or in any composed one. Whether the demand/supply
  // pass called it external or nothing at all, there is no declared lifetime to rank.
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
 *
 * `composedSupply` is not optional in spirit — an app-mode run that omits it gets the pre-composition
 * behaviour, where every edge into a library is invisible. It is optional in the signature because
 * a library generating its own manifest composes nothing and has none to pass.
 *
 * ### Not transitive, and knowingly so
 *
 * Only a consumer's DIRECT dependency keys (plus one group hop) are ranked. Awilix strict mode
 * rejects a scoped resolution under any singleton ANCESTOR on the resolution stack, not merely a
 * singleton direct parent — so `singleton → transient → scoped` is two warnings and zero errors
 * here, and still throws at first resolve. Closing that means walking the demand graph rather than
 * scanning edges, and it is separate work.
 */
export const validateLifetimeInversionsAtCodegen = (
  acceptedFactories: readonly DiscoveredFactory[],
  plans: readonly ResolvedContractRegistration[],
  groupsManifest: IocGroupsManifest | undefined,
  demandSupply: DemandSupplyAnalysisResult,
  config: IocConfig | undefined,
  composedSupply?: ComposedManifestSupply,
): void => {
  const { regLifetime, accessKeyToDefaultLifetime } =
    buildLifetimeLookups(plans);

  const composedUnits = new Map<string, ComposedManifestUnit>();
  for (const unit of composedSupply?.units ?? []) {
    if (!composedUnits.has(unit.registrationKey)) {
      composedUnits.set(unit.registrationKey, unit);
    }
  }

  const ctx: DepResolutionContext = {
    regLifetime,
    accessKeyToDefaultLifetime,
    groupsManifest,
    composedUnits,
    composedGroupRoots: composedSupply?.groupRootsByGroupKey ?? new Map(),
    composedAccessKeys: composedSupply?.accessKeys ?? new Map(),
    externalKeys: new Set(demandSupply.externalKeys),
    scopeProvidedKeys: new Set(demandSupply.scopeProvidedKeys),
  };

  const inversions: LifetimeInversion[] = [];
  const undetermined: UndeterminedEdge[] = [];

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

      const resolved = resolveDepCandidates(depKey, ctx);
      if (resolved === "skip") {
        continue;
      }

      for (const candidate of resolved) {
        if (candidate.kind === "undetermined") {
          // A transient consumer outlives nothing, so no lifetime this member could have turned out
          // to hold would have produced a finding. Disclosing an edge that could not have been
          // reported either way is noise, not honesty.
          if (consumerLifetime !== "transient") {
            undetermined.push({
              consumerKey: factory.registrationKey,
              consumerLifetime,
              depKey,
              memberKey: candidate.memberKey,
              registrationKey: candidate.registrationKey,
              origin: candidate.origin,
            });
          }
          continue;
        }

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
          ...(candidate.packageNames !== undefined
            ? { packageNames: candidate.packageNames }
            : {}),
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

  for (const edge of undetermined) {
    console.warn(
      `[ioc] ${formatUndeterminedMessage(edge)}` +
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
