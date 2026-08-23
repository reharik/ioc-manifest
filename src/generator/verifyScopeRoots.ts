/**
 * @fileoverview Scope-root stage 2: demand–supply verification of a declared late-bound-value set
 * against the resolution subtree under the root contract.
 *
 * The check is **per variant** (see `docs/design/scope-roots.md`, "Append to the variants section"):
 * satisfaction is decided against one variant's declared lbv, and the variant is a parameter of the
 * check signature from the start — lbv sets are never unioned or intersected across the variants of
 * a root contract.
 *
 * Direction: **supplied `extends` demanded**, the same direction the externals-satisfaction check
 * runs (`AppCradle[K] extends Externals[K]`). The lbv-supplied type must be assignable to the type
 * the subtree demands, never the inverse.
 *
 * lbv resolution discipline: the record keeps whatever stage 1 captured — the raw `ts.TypeNode`, or
 * nothing at all when the declaration was made by omitting the type argument — and keeps it forever.
 * The checker is applied to it in `declaredLbv.ts`, the single seam both this pass and opener
 * emission read the declaration through, and the resolved types never travel back into a
 * {@link DiscoveredScopeRoot}. Demanded types are resolved the same way — lazily, and only for the
 * keys that turn out to be scope-demands.
 */
import path from "node:path";
import ts from "typescript";
import type { IocConfig, IocLifetime } from "../config/iocConfig.js";
import type { IocGroupsManifest } from "../core/manifest.js";
import {
  docsPointerLine,
  docsPointerSuffix,
} from "../diagnostics/errorDocs.js";
import { readDeclaredLbv } from "./declaredLbv.js";
import { unitDepsSignatureDecl } from "./discoverFactories/contractSite.js";
import { collectFileAnalysisForFactoryDiscovery } from "./discoverFactories/scanFactoryFile.js";
import {
  EMPTY_COMPOSED_MANIFEST_SUPPLY,
  type ComposedManifestSupply,
  type ComposedManifestUnit,
} from "./loadComposedManifestUnits.js";
import {
  resolveFactorySourceAbsPath,
  type FactoryDiscoveryPaths,
} from "./manifestPaths.js";
import type { ResolvedContractRegistration } from "./resolveRegistrationPlan.js";
import { contractSlotsForPlans } from "./contractSlotKeys.js";
import type { DiscoveredFactory, DiscoveredScopeRoot } from "./types.js";
import {
  inversionSeverity,
  isLifetimeInversionSuppressed,
} from "./validateLifetimeInversionsAtCodegen.js";

/**
 * The sentence every missing-key error must carry.
 *
 * It exists for one reader: the developer who knows an enclosing scope supplies the key, sees the
 * failure, and concludes the tool is broken. Per the design doc's core principle, per-root
 * declarations are complete precisely so a root stays transportable — so the error states the rule
 * rather than leaving the reader to infer a bug.
 */
const PER_ROOT_COMPLETENESS_NOTE =
  "Scope-root declarations are per-root and COMPLETE: every late-bound value the subtree resolves must be named in this variant's own ScopeRoot type argument — including keys an enclosing SCOPE also happens to supply. The tool never models scope ancestry, so a key being ambient at an outer scope does not satisfy it here; that is the rule, not a gap. (Values the root CONTAINER supplies are a different thing and are already excluded: manifest registrations, group keys and externals are container-supplied and never need declaring. This key is neither.) Declare it here.";

export type ScopeRootFindingCode =
  | "lbv_missing_key"
  | "lbv_type_mismatch"
  | "lbv_unused_key"
  | "lifetime_inversion"
  /**
   * The subtree reaches a composed package whose manifest carries no dependency data, so part of
   * this variant's subtree could not be walked. Advisory, never an error — see
   * {@link formatComposedBlindSpotAdvisory}.
   */
  | "lbv_composed_blind_spot";

export type ScopeRootFinding = {
  severity: "error" | "warn";
  code: ScopeRootFindingCode;
  /** The demanded or declared key the finding is about. */
  key: string;
  message: string;
};

/**
 * One unit inside a variant's resolution subtree.
 *
 * Identity is (modulePath, exportName), the pair every other join in the generator uses, because
 * the variant unit itself has no registration key to be identified by.
 */
export type ScopeRootSubtreeUnit = {
  exportName: string;
  /** Package-qualified for a composed unit (see {@link ComposedManifestUnit.modulePath}). */
  modulePath: string;
  /** Absent for the scope-root unit itself, which claims no registration key. */
  registrationKey?: string;
  /** Set when the unit came from a composed package manifest rather than local discovery. */
  packageName?: string;
};

/** How a scope-demand was resolved against the variant's declaration. */
export type ScopeDemandSatisfaction =
  | "declared-lbv"
  | "undeclared"
  | "type-mismatch";

/**
 * A key under a variant's subtree that the caller could not resolve but generation can — today only
 * a group root key seen without a group plan (inspection). Container-supplied, never a scope-demand:
 * the report must not claim unsatisfied for a key generation satisfies.
 */
export type ScopeRootGenerationResolvedKey = {
  key: string;
  via: "group";
  /** Variant name first, then the registration keys walked to reach the demanding unit. */
  viaPath: readonly string[];
  demandedBy: { exportName: string; modulePath: string; packageName?: string };
};

/**
 * One key demanded under a variant's subtree that must enter at the scope boundary — neither a
 * manifest registration, a group key, nor an external supplies it.
 */
export type ScopeRootScopeDemand = {
  key: string;
  /** Variant name first, then the registration keys walked to reach the demanding unit. */
  viaPath: readonly string[];
  demandedBy: { exportName: string; modulePath: string; packageName?: string };
  satisfiedBy: ScopeDemandSatisfaction;
  /** Demanded type as text, when the checker could resolve it at the demand site. */
  demandedTypeText?: string;
  /** The declared lbv member's type as text, when the declaration named the key. */
  suppliedTypeText?: string;
};

export type ScopeRootVariantVerification = {
  contractName: string;
  variantName: string;
  exportName: string;
  modulePath: string;
  /** The declared lbv as written. The raw node stays on the record; this is its source text. */
  declaredLbv: string;
  /**
   * Property names read off the declared lbv type, sorted. Reporting only — the report renders the
   * key list rather than the whole type text, and this is the same list the walk was seeded with.
   */
  declaredKeys: readonly string[];
  /**
   * Every unit this variant's subtree covers, the variant itself first.
   *
   * Carried for emission, which needs to know whether a demand of a declared key comes from inside
   * a declaring variant's subtree or from outside it. Nothing in this file reads it back:
   * satisfaction is per variant, and a cross-variant question is exactly the kind this record must
   * not answer for itself.
   */
  subtreeUnits: readonly ScopeRootSubtreeUnit[];
  /** Scope-demands of this variant's subtree, sorted by key. */
  scopeDemands: readonly ScopeRootScopeDemand[];
  /**
   * Container-supplied keys this caller could not expand but generation resolves, sorted by key.
   * Empty at generation; populated for inspection, which has no group plan.
   */
  generationResolvedKeys: readonly ScopeRootGenerationResolvedKey[];
  /** Declared lbv keys the subtree never demands (dead weight on the boundary contract). */
  unusedDeclaredKeys: readonly string[];
  /**
   * Composed packages this variant's subtree reaches whose manifests carry no dependency data,
   * sorted.
   *
   * The stated blind spot behind this variant's verdict. Non-empty means `satisfied` is a verdict
   * over the part of the subtree that could be walked, not over the whole of it.
   */
  blindComposedPackages: readonly string[];
  findings: readonly ScopeRootFinding[];
  /** True when the variant produced no error-severity finding. */
  satisfied: boolean;
};

export type ScopeRootVerificationResult = {
  variants: readonly ScopeRootVariantVerification[];
  /** Formatted error-severity messages, one per offending variant finding. */
  errors: readonly string[];
  /** Formatted warn-severity messages. */
  warnings: readonly string[];
};

export type ScopeRootVerificationContext = {
  program: ts.Program;
  projectRoot: string;
  scanDirs: FactoryDiscoveryPaths["scanDirs"];
  /** Manifest registrations — the supply side that is NOT a scope-demand. */
  acceptedFactories: readonly DiscoveredFactory[];
  plans: readonly ResolvedContractRegistration[];
  groupsManifest?: IocGroupsManifest;
  config?: IocConfig;
  /**
   * Keys the demand/supply pass classified `external` — container-constant values the composing app
   * registers on the root container, verified by the externals-satisfaction check at composition.
   * They are container-supplied, NOT scope-demands (see the boundary ruling in the design doc).
   *
   * Generation passes the authoritative set, and when it is present a key is external only by
   * membership in it. Inspection has no demand/supply pass and leaves it unset, which licenses the
   * permissive by-elimination fallback in {@link classifyDemandedKey}. Unset and empty are
   * therefore different: empty means "generation found no externals", not "unknown".
   */
  externalKeys?: readonly string[];
  /**
   * Registration units, contract aliases and group roots carried in by composed package manifests
   * (app mode).
   *
   * Without this the walk stops at the package boundary: a composed key resolves to nothing local,
   * falls through to `external`, and everything the composed unit itself demands is invisible —
   * which reports a declared key as never demanded when a composed unit demands it, and, worse,
   * reports a variant satisfied when a composed unit demands a key nothing supplies. Unset means
   * "this package composes nothing", which is the library-mode and single-package case.
   */
  composedSupply?: ComposedManifestSupply;
};

const normalizePath = (p: string): string => path.normalize(p);

const relModulePath = (projectRoot: string, modulePath: string): string =>
  path
    .relative(projectRoot, path.join(projectRoot, modulePath))
    .replace(/\\/g, "/");

/** Manifest-registration supply, indexed the way the walk consumes it. */
export type ScopeRootSupplyIndex = {
  factoryByRegistrationKey: Map<string, DiscoveredFactory>;
  /**
   * Units a composed package manifest supplies, by registration key.
   *
   * Kept apart from {@link factoryByRegistrationKey} rather than synthesized into it: a composed
   * unit is not a discovered factory and has no source file in this program, so half the fields of
   * a `DiscoveredFactory` would have to be invented. Provenance is also exactly what the walk needs
   * to report — an error naming a unit in another package reads very differently from one naming a
   * local file — so the two are never conflated. A key can appear in at most one of the two maps:
   * a local registration and a composed one under the same key is a composition collision the
   * runtime already rejects, and locals win here so this pass never disagrees with discovery.
   */
  composedUnitByRegistrationKey: Map<string, ComposedManifestUnit>;
  registrationKeyByAccessKey: Map<string, string>;
  lifetimeByRegistrationKey: Map<string, IocLifetime>;
  groupMemberKeysByGroupKey: Map<string, readonly string[]>;
  /**
   * Group root keys as written in `ioc.config.groups`. Identical to the group-plan's root keys, but
   * readable without a group plan — which is what lets inspection tell "generation resolves this as
   * a group" apart from "nothing supplies this".
   */
  declaredGroupKeys: ReadonlySet<string>;
  /** `ioc.config.scopeProvided` — keys declared to enter at a scope boundary rather than the root. */
  scopeProvidedKeys: ReadonlySet<string>;
  /**
   * The demand/supply pass's external set when one was threaded (generation), `undefined` when none
   * was (inspection). Presence, not content, decides whether `external` may be reached by
   * elimination — see {@link classifyDemandedKey}.
   */
  externalKeys: ReadonlySet<string> | undefined;
  /**
   * Composed packages whose manifest carries no dependency data, sorted.
   *
   * Carried on the index because it travels with the supply it qualifies: every verdict drawn from
   * this index over a subtree touching one of these packages is incomplete, and the caller has to
   * be able to say so.
   */
  packagesWithoutDependencyData: readonly string[];
};

const groupMemberRegistrationKeys = (
  manifest: IocGroupsManifest[string],
): string[] =>
  Array.isArray(manifest.members)
    ? manifest.members.map((m) => m.registrationKey)
    : Object.values(manifest.members).map((leaf) => leaf.registrationKey);

/**
 * The container's supply side, indexed the way both the subtree walk and Externals exclusion
 * consume it.
 *
 * Exported so exclusion resolves a demanded key to its supplying registrations through the SAME
 * table verification measures against, rather than growing a second, drifting idea of what supplies
 * a key. Exclusion reads only the registration-resolution parts; it never reads (and must never
 * read) `externalKeys` or `scopeProvidedKeys`, which are classification, not graph shape.
 */
export const buildScopeRootSupplyIndex = (
  ctx: ScopeRootVerificationContext,
): ScopeRootSupplyIndex => {
  const factoryByRegistrationKey = new Map<string, DiscoveredFactory>();
  for (const factory of ctx.acceptedFactories) {
    factoryByRegistrationKey.set(factory.registrationKey, factory);
  }

  const lifetimeByRegistrationKey = new Map<string, IocLifetime>();
  for (const plan of ctx.plans) {
    for (const impl of plan.implementations) {
      lifetimeByRegistrationKey.set(impl.registrationKey, impl.lifetime);
    }
  }

  // Contract slot keys, through the one derivation every layer shares. A plan with no ELECTED
  // default contributes nothing: the key does not exist in the cradle, is not registered at boot,
  // and must not resolve here either — a walk that descended through a key the container will not
  // have would report a variant satisfied on the strength of an edge that does not exist.
  const registrationKeyByAccessKey = new Map<string, string>(
    contractSlotsForPlans(ctx.plans).map((slot) => [
      slot.accessKey,
      slot.electedRegistrationKey,
    ]),
  );

  const composed = ctx.composedSupply ?? EMPTY_COMPOSED_MANIFEST_SUPPLY;

  // Composed units join the container's supply exactly where `registerIocFromManifest` will put
  // them: under their own registration key, plus the contract default-slot alias. A LOCAL
  // registration under the same key wins — locals are what discovery actually saw, and a genuine
  // collision between the two is composition's error to raise, not this pass's.
  const composedUnitByRegistrationKey = new Map<string, ComposedManifestUnit>();
  for (const unit of composed.units) {
    if (factoryByRegistrationKey.has(unit.registrationKey)) {
      continue;
    }
    composedUnitByRegistrationKey.set(unit.registrationKey, unit);
    if (!lifetimeByRegistrationKey.has(unit.registrationKey)) {
      lifetimeByRegistrationKey.set(unit.registrationKey, unit.lifetime);
    }
  }
  for (const [accessKey, registrationKey] of composed.accessKeys) {
    if (!registrationKeyByAccessKey.has(accessKey)) {
      registrationKeyByAccessKey.set(accessKey, registrationKey);
    }
  }

  const groupMemberKeysByGroupKey = new Map<string, readonly string[]>();
  for (const [groupKey, manifest] of Object.entries(
    ctx.groupsManifest ?? {},
  )) {
    groupMemberKeysByGroupKey.set(
      groupKey,
      groupMemberRegistrationKeys(manifest),
    );
  }
  // Group roots MERGE across composed manifests rather than shadow one another (see
  // `composeManifests`), so a group key present both locally and in a composed package resolves to
  // the union of both member lists — which is the collection the cradle will actually hand out.
  for (const [groupKey, members] of composed.groupMembersByGroupKey) {
    const local = groupMemberKeysByGroupKey.get(groupKey) ?? [];
    groupMemberKeysByGroupKey.set(groupKey, [
      ...local,
      ...members.filter((member) => !local.includes(member)),
    ]);
  }

  return {
    factoryByRegistrationKey,
    composedUnitByRegistrationKey,
    registrationKeyByAccessKey,
    lifetimeByRegistrationKey,
    groupMemberKeysByGroupKey,
    packagesWithoutDependencyData: composed.packagesWithoutDependencyData,
    declaredGroupKeys: new Set(Object.keys(ctx.config?.groups ?? {})),
    scopeProvidedKeys: new Set(ctx.config?.scopeProvided ?? []),
    // `undefined` and empty are NOT the same thing here: unset means "no authoritative set was
    // threaded" (inspection), empty means "generation ran the demand/supply pass and it classified
    // nothing external". Only the first licenses classification by elimination.
    externalKeys:
      ctx.externalKeys === undefined ? undefined : new Set(ctx.externalKeys),
  };
};

/**
 * The registration keys a demanded key resolves to, in the container's own precedence: a group root
 * expands to its members, then a registration key, then a contract access key. Empty when nothing
 * local supplies it (an external, a scope-demand, or a group with no plan).
 *
 * The one place that precedence is written down; {@link classifyDemandedKey} and Externals
 * exclusion both go through it.
 */
export const registrationsSupplyingKey = (
  key: string,
  index: ScopeRootSupplyIndex,
): readonly string[] => {
  const groupMembers = index.groupMemberKeysByGroupKey.get(key);
  if (groupMembers !== undefined) {
    return groupMembers;
  }
  if (
    index.factoryByRegistrationKey.has(key) ||
    index.composedUnitByRegistrationKey.has(key)
  ) {
    return [key];
  }
  const viaAccessKey = index.registrationKeyByAccessKey.get(key);
  return viaAccessKey !== undefined ? [viaAccessKey] : [];
};

/**
 * What supplies one demanded cradle key under a scope root.
 *
 * `registrations` is the only kind the walk descends through; the rest are leaves.
 */
type DemandedKeySupply =
  /** A manifest registration, contract access key, or planned group — the walk descends. */
  | { kind: "registrations"; registrationKeys: readonly string[] }
  /**
   * A group root key that generation resolves but this caller has no plan for (inspection). It is
   * container-supplied; the members are simply not enumerable here.
   */
  | { kind: "group-at-generation" }
  /** Container-constant, registered on the root container by the composing app. */
  | { kind: "external" }
  /** Must enter at the scope boundary — the variant's declaration has to carry it. */
  | { kind: "scope-demand" };

/**
 * Classifies one demanded key against the container's supply and this variant's declaration.
 *
 * The boundary ruling: container-supplied means manifest registrations, group keys, AND externals.
 * Externals and late-bound values are distinct concepts with distinct lifecycles — an external is a
 * container-constant verified once at composition by the externals-satisfaction check, an lbv is
 * supplied afresh at every scope opening. A subtree dependency that resolves to an external is
 * therefore NOT a scope-demand and must not be required in a variant's lbv.
 *
 * The per-root completeness principle still holds, but it governs scope ancestry only: a scope can
 * be re-mounted under a different parent scope, so a key an enclosing SCOPE supplies must still be
 * declared here. It can never be transported away from its root container, so a key the root
 * container supplies needs no redeclaration.
 *
 * `variantLbvKeys` is a parameter for the same reason the whole check is per-variant: declaring a
 * key in a variant's lbv IS the declaration that this boundary carries it, so it is what makes the
 * key a scope-demand for THIS variant and no other.
 */
const classifyDemandedKey = (
  key: string,
  index: ScopeRootSupplyIndex,
  variantLbvKeys: ReadonlySet<string>,
): DemandedKeySupply => {
  const registrationKeys = registrationsSupplyingKey(key, index);
  if (registrationKeys.length > 0) {
    return { kind: "registrations", registrationKeys };
  }
  // Only reachable without a group plan, i.e. from inspection. Generation matched it above.
  if (index.declaredGroupKeys.has(key)) {
    return { kind: "group-at-generation" };
  }
  // A key this variant declares is a late-bound value of this boundary by declaration, so it is
  // checked as one even when the demand/supply pass also classified it external. That overlap is
  // deliberately not a conflict diagnostic — the declaration simply wins and the key is verified.
  if (variantLbvKeys.has(key) || index.scopeProvidedKeys.has(key)) {
    return { kind: "scope-demand" };
  }

  // Generation: `external` is MEMBERSHIP in the demand/supply pass's set, never elimination. The
  // difference is load-bearing for one case — a key only the scope-root unit itself demands. Scope
  // roots are excluded from `acceptedFactories`, so demand/supply never walks them; such a key is
  // absent from `externalKeys` and from the emitted `Externals` interface, so nothing downstream
  // would ever check it. A subtree key at least has a wrong-but-loud backstop (it surfaces in
  // `Externals` and fails composition); a root-own key has none, so it must be declared here.
  if (index.externalKeys !== undefined) {
    return index.externalKeys.has(key)
      ? { kind: "external" }
      : { kind: "scope-demand" };
  }

  // Inspection: no authoritative set was threaded, so `external` is reached by elimination — not
  // locally registered, not declared as entering at a scope. Permissive on purpose, and the same
  // stance the group-key row takes: generation is the authority, inspection is a view that must
  // never claim a failure generation does not have. Root-own keys therefore read external here and
  // scope-demand at generation; the divergence is intentional and pinned by test.
  return { kind: "external" };
};

/** A unit that demands a key, in the walk's terms. */
type DemandingUnit = {
  exportName: string;
  modulePath: string;
  /** Absent for the scope-root unit itself, which claims no registration key. */
  registrationKey?: string;
  lifetime: IocLifetime;
  dependencyKeys: readonly string[];
  /** Set when the unit came from a composed package manifest rather than local discovery. */
  packageName?: string;
};

const scopeRootAsDemandingUnit = (
  variant: DiscoveredScopeRoot,
): DemandingUnit => ({
  exportName: variant.exportName,
  modulePath: variant.modulePath,
  lifetime: variant.lifetime,
  dependencyKeys: variant.dependencyKeys ?? [],
});

const factoryAsDemandingUnit = (
  factory: DiscoveredFactory,
  lifetime: IocLifetime,
): DemandingUnit => ({
  exportName: factory.exportName,
  modulePath: factory.modulePath,
  registrationKey: factory.registrationKey,
  lifetime,
  dependencyKeys: factory.dependencyKeys ?? [],
});

/**
 * A composed unit in the walk's terms.
 *
 * Its demand set comes from the manifest and nowhere else — there is no source file here to read,
 * which is the whole reason generation has to write the keys down. `dependencyKeys: undefined`
 * (an old manifest) reads as no edges, the same shape a unit with no dependencies has; the
 * DIFFERENCE between those two is carried separately, by the blind-spot advisory, because a walk
 * cannot represent "I don't know" as an edge.
 */
const composedUnitAsDemandingUnit = (
  unit: ComposedManifestUnit,
): DemandingUnit => ({
  exportName: unit.exportName,
  modulePath: unit.modulePath,
  registrationKey: unit.registrationKey,
  lifetime: unit.lifetime,
  dependencyKeys: unit.dependencyKeys ?? [],
  packageName: unit.packageName,
});

/** One (demanding unit, key) pair discovered by the walk. */
type DemandEdge = {
  key: string;
  unit: DemandingUnit;
  /** Variant name first, then registration keys down to `unit`. */
  viaPath: readonly string[];
};

type SubtreeWalk = {
  /**
   * Every unit this variant's subtree covers, the variant itself included.
   *
   * Reported rather than judged: it is the subtree as a graph fact, and it is the same set no
   * matter what the variant declares (only `registrations` descends, and that classification is
   * decided before the declaration is consulted). Externals exclusion uses it to ask whether a
   * demand of a declared key sits inside a declaring subtree; verification does not use it at all,
   * and must not — satisfaction is decided per variant against that variant's declaration.
   */
  subtreeUnits: readonly ScopeRootSubtreeUnit[];
  /** Scope-demand edges: keys that must enter at the boundary. Every occurrence, in BFS order. */
  scopeDemandEdges: readonly DemandEdge[];
  /** Edges whose key resolves to registrations, with the resolved lifetimes (for inversion). */
  registeredEdges: readonly (DemandEdge & {
    depRegistrationKey: string;
    depLifetime: IocLifetime;
  })[];
  /** Group root keys generation resolves that this caller could not expand (inspection). */
  generationResolvedGroupEdges: readonly DemandEdge[];
  /**
   * Composed packages this subtree actually reached whose manifests carry no dependency data,
   * sorted.
   *
   * Reached, not merely composed: a package the app depends on but whose units this subtree never
   * resolves puts no blind spot in THIS variant's verdict, and saying otherwise would train readers
   * to ignore the advisory.
   */
  blindComposedPackages: readonly string[];
};

/**
 * Breadth-first walk of the resolution subtree under one variant.
 *
 * Edges are the units' `dependencyKeys` — the destructured deps property names, the same demand set
 * ordinary factories get from {@link inferFactoryDependencies}. A unit whose deps parameter is not a
 * top-level object binding pattern contributes no edges, which is the existing "prefer omission"
 * policy rather than a scope-root-specific rule — so a scope-demand reachable only behind a
 * rest-spread or non-destructured deps parameter is invisible to this check, at parity with
 * ordinary factory analysis.
 */
const walkSubtree = (
  variant: DiscoveredScopeRoot,
  index: ScopeRootSupplyIndex,
  variantLbvKeys: ReadonlySet<string>,
): SubtreeWalk => {
  const subtreeUnits: ScopeRootSubtreeUnit[] = [];
  const scopeDemandEdges: DemandEdge[] = [];
  const generationResolvedGroupEdges: DemandEdge[] = [];
  const registeredEdges: (DemandEdge & {
    depRegistrationKey: string;
    depLifetime: IocLifetime;
  })[] = [];
  const blindPackages = new Set<string>();
  const packagesWithoutDependencyData = new Set(
    index.packagesWithoutDependencyData,
  );

  const expanded = new Set<string>();
  const queue: { unit: DemandingUnit; viaPath: readonly string[] }[] = [
    { unit: scopeRootAsDemandingUnit(variant), viaPath: [variant.variantName] },
  ];

  while (queue.length > 0) {
    const { unit, viaPath } = queue.shift()!;

    subtreeUnits.push({
      exportName: unit.exportName,
      modulePath: unit.modulePath,
      ...(unit.registrationKey !== undefined
        ? { registrationKey: unit.registrationKey }
        : {}),
      ...(unit.packageName !== undefined
        ? { packageName: unit.packageName }
        : {}),
    });

    if (
      unit.packageName !== undefined &&
      packagesWithoutDependencyData.has(unit.packageName)
    ) {
      blindPackages.add(unit.packageName);
    }

    for (const key of unit.dependencyKeys) {
      const supply = classifyDemandedKey(key, index, variantLbvKeys);

      if (supply.kind === "scope-demand") {
        scopeDemandEdges.push({ key, unit, viaPath });
        continue;
      }
      if (supply.kind === "group-at-generation") {
        generationResolvedGroupEdges.push({ key, unit, viaPath });
        continue;
      }
      if (supply.kind === "external") {
        // Container-constant, supplied on the root container and verified by the externals check
        // at composition. Not a scope-demand, and nothing under it to walk.
        continue;
      }

      for (const target of supply.registrationKeys) {
        const depLifetime = index.lifetimeByRegistrationKey.get(target);
        if (depLifetime !== undefined) {
          registeredEdges.push({
            key,
            unit,
            viaPath,
            depRegistrationKey: target,
            depLifetime,
          });
        }

        if (expanded.has(target)) {
          continue;
        }
        expanded.add(target);

        const factory = index.factoryByRegistrationKey.get(target);
        if (factory !== undefined) {
          queue.push({
            unit: factoryAsDemandingUnit(factory, depLifetime ?? "singleton"),
            viaPath: [...viaPath, target],
          });
          continue;
        }

        // Not local — a composed package supplies it. Same descent, same edges: what makes a unit
        // walkable is having a demand set, not having a source file in this program.
        const composedUnit = index.composedUnitByRegistrationKey.get(target);
        if (composedUnit !== undefined) {
          queue.push({
            unit: composedUnitAsDemandingUnit(composedUnit),
            viaPath: [...viaPath, target],
          });
        }
      }
    }
  }

  return {
    subtreeUnits,
    scopeDemandEdges,
    registeredEdges,
    generationResolvedGroupEdges,
    blindComposedPackages: [...blindPackages].sort((a, b) =>
      a.localeCompare(b),
    ),
  };
};

/**
 * The deps type node of a unit, located from its (modulePath, exportName) identity.
 *
 * Returns the *node*, never a resolved type: callers resolve at the boundary, for one property, and
 * only when that property turned out to be a scope-demand.
 */
const sourceFileIndexByProgram = new WeakMap<
  ts.Program,
  Map<string, ts.SourceFile>
>();

const sourceFileAt = (
  program: ts.Program,
  absPath: string,
): ts.SourceFile | undefined => {
  let index = sourceFileIndexByProgram.get(program);
  if (index === undefined) {
    index = new Map(
      program.getSourceFiles().map((sf) => [normalizePath(sf.fileName), sf]),
    );
    sourceFileIndexByProgram.set(program, index);
  }
  return index.get(absPath);
};

const depsTypeNodeForUnit = (
  ctx: ScopeRootVerificationContext,
  unit: DemandingUnit,
): ts.TypeNode | undefined => {
  const sourceFile = sourceFileAt(
    ctx.program,
    normalizePath(
      resolveFactorySourceAbsPath(
        unit.modulePath,
        ctx.projectRoot,
        ctx.scanDirs,
      ),
    ),
  );
  if (sourceFile === undefined) {
    return undefined;
  }
  const decl = collectFileAnalysisForFactoryDiscovery(
    sourceFile,
  ).unitDeclByExport.get(unit.exportName);
  if (decl === undefined) {
    return undefined;
  }
  return unitDepsSignatureDecl(decl)?.parameters[0]?.type;
};

/**
 * The type demanded for `key` at a demand site. Resolved lazily and only for scope-demand keys, so
 * a deps type is never handed to the checker on account of a key the container already supplies.
 */
const demandedTypeAtSite = (
  ctx: ScopeRootVerificationContext,
  checker: ts.TypeChecker,
  unit: DemandingUnit,
  key: string,
): ts.Type | undefined => {
  // A composed unit's source is in another package and is not in this program — the manifest
  // carries its demand KEYS, never its demand types. No type means no assignability check for that
  // demand, which is the same "cannot resolve, do not judge" stance this function already takes for
  // a local unit whose deps node it fails to find.
  if (unit.packageName !== undefined) {
    return undefined;
  }
  const depsTypeNode = depsTypeNodeForUnit(ctx, unit);
  if (depsTypeNode === undefined) {
    return undefined;
  }
  const depsType = checker.getApparentType(
    checker.getTypeFromTypeNode(depsTypeNode),
  );
  const prop = checker.getPropertyOfType(depsType, key);
  return prop === undefined ? undefined : checker.getTypeOfSymbol(prop);
};

const typeText = (checker: ts.TypeChecker, type: ts.Type): string =>
  checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);

const variantLabel = (
  ctx: ScopeRootVerificationContext,
  variant: DiscoveredScopeRoot,
): string =>
  `Scope root "${variant.contractName}" variant "${variant.variantName}" (export ${JSON.stringify(variant.exportName)} in ${relModulePath(ctx.projectRoot, variant.modulePath)})`;

/**
 * Where a demand was made, in the reader's terms.
 *
 * A composed unit is called out as such and by package: the reader cannot open that file in this
 * repository, and "this comes from a library you compose" is the single most useful fact about the
 * demand — without it the path names an export nobody here wrote.
 */
const demandSiteLabel = (
  ctx: ScopeRootVerificationContext,
  edge: DemandEdge,
): string => {
  const site =
    edge.unit.packageName !== undefined
      ? `${edge.unit.modulePath} (composed package ${JSON.stringify(edge.unit.packageName)})`
      : relModulePath(ctx.projectRoot, edge.unit.modulePath);
  return `demanded by ${JSON.stringify(edge.unit.exportName)} in ${site} (via ${[...edge.viaPath, edge.key].join(" → ")})`;
};

/**
 * The advisory a variant carries when part of its subtree could not be walked.
 *
 * Advisory and never an error, deliberately. Nothing is known to be wrong — what is known is that
 * the verdict does not cover the whole subtree, and a ✔ with a stated blind spot is honest where a
 * bare ✔ is not. Upgrading it to a failure would break every app composing a package that has not
 * regenerated yet, which is a bootstrap tax on the innocent; downgrading it to silence is the
 * false confidence this whole check exists to remove.
 */
const formatComposedBlindSpotAdvisory = (
  ctx: ScopeRootVerificationContext,
  variant: DiscoveredScopeRoot,
  packageNames: readonly string[],
): string =>
  [
    `[ioc] ${variantLabel(ctx, variant)}: the resolution subtree reaches composed package(s) ${packageNames.map((name) => JSON.stringify(name)).join(", ")} whose manifest carries no dependency data, so late-bound-value verification is INCOMPLETE for that part of the subtree.`,
    `    Anything those packages' units demand is invisible here: a declared key they demand may be reported as never demanded, and an undeclared key they demand cannot be reported at all.`,
    `    Fix: regenerate those packages with a version of ioc-manifest that writes "dependencyKeys" into the manifest, then re-run generation here.`,
    ...docsFooter("lbv_composed_blind_spot"),
  ].join("\n");

/**
 * The third register for a scope-root finding: one indented line naming the page that articulates
 * the rule. Indented to sit with the mechanism lines rather than with the sentence, because these
 * messages put their sentence on line one and everything else underneath it.
 */
const docsFooter = (code: ScopeRootFindingCode): string[] => {
  const line = docsPointerLine(code);
  return line === undefined ? [] : [`    ${line}`];
};

const formatMissingKeyError = (
  ctx: ScopeRootVerificationContext,
  variant: DiscoveredScopeRoot,
  edge: DemandEdge,
): string =>
  [
    `[ioc] ${variantLabel(ctx, variant)}: the resolution subtree demands ${JSON.stringify(edge.key)}, which no manifest registration supplies and this variant's declared late-bound-value set does not name.`,
    `    ${demandSiteLabel(ctx, edge)}`,
    `    declared lbv: ${variant.lbvTypeText}`,
    `    ${PER_ROOT_COMPLETENESS_NOTE}`,
    `    Fix: add ${JSON.stringify(edge.key)} to the second type argument of ScopeRoot<${variant.contractName}, ...> on ${JSON.stringify(variant.exportName)}.`,
    ...docsFooter("lbv_missing_key"),
  ].join("\n");

const formatTypeMismatchError = (
  ctx: ScopeRootVerificationContext,
  variant: DiscoveredScopeRoot,
  edge: DemandEdge,
  suppliedText: string,
  demandedText: string,
): string =>
  [
    `[ioc] ${variantLabel(ctx, variant)}: the declared late-bound value ${JSON.stringify(edge.key)} is not assignable to what the subtree demands.`,
    `    declared (supplied): ${suppliedText}`,
    `    demanded:            ${demandedText}`,
    `    ${demandSiteLabel(ctx, edge)}`,
    `    The check runs supplied extends demanded — the value the scope carries must satisfy every consumer under the root, never the other way round. Widen the consumer's type or narrow the declaration.`,
    ...docsFooter("lbv_type_mismatch"),
  ].join("\n");

const formatUnusedKeyWarning = (
  ctx: ScopeRootVerificationContext,
  variant: DiscoveredScopeRoot,
  key: string,
  containerSupplied: boolean,
): string =>
  `[ioc] ${variantLabel(ctx, variant)}: declared late-bound value ${JSON.stringify(key)} is never demanded under the root${containerSupplied ? " (a manifest registration already supplies that key, so the scope boundary never carries it)" : ""}. The boundary contract carries dead weight — every opening site must pass a value nothing resolves. Remove it from the declaration, or wire the consumer that was meant to demand it.${docsPointerSuffix("lbv_unused_key")}`;

const formatScopeRootInversion = (
  ctx: ScopeRootVerificationContext,
  variant: DiscoveredScopeRoot,
  consumer: DemandingUnit,
  depKey: string,
  depLifetime: IocLifetime,
  viaPath: readonly string[],
  lbvDeclared: boolean,
): string => {
  const consumerLabel =
    consumer.registrationKey ?? `${variant.variantName} (scope root)`;
  const consumerSite =
    consumer.packageName !== undefined
      ? `${JSON.stringify(consumer.exportName)} in ${consumer.modulePath} (composed package ${JSON.stringify(consumer.packageName)})`
      : `${JSON.stringify(consumer.exportName)} in ${relModulePath(ctx.projectRoot, consumer.modulePath)}`;
  const depPhrase = lbvDeclared
    ? `'${depKey}' (late-bound value of scope root "${variant.contractName}" variant "${variant.variantName}", per-scope)`
    : `'${depKey}' (${depLifetime})`;
  const head = `Lifetime inversion under scope root "${variant.contractName}" variant "${variant.variantName}": '${consumerLabel}' (${consumer.lifetime}, ${consumerSite}) depends on ${depPhrase}.`;
  const detail =
    consumer.lifetime === "singleton"
      ? " A singleton freezes its scoped dependency at first construction, reusing it across every scope opened from this root."
      : " A longer-lived consumer should not depend on a shorter-lived dependency.";
  const trail = ` via ${[...viaPath, depKey].join(" → ")}. Register '${consumerLabel}' as scoped (or shorter), or mark it intentional with registrations['<Contract>'].<impl>.allowLifetimeInversion.`;
  return `[ioc] ${head}${detail}${trail}${docsPointerSuffix("lifetime_inversion")}`;
};

/**
 * Whether `registrations[<contract>].<impl>.allowLifetimeInversion` silences this edge.
 *
 * Composed units are ranked for inversion exactly like local ones — the lifetime in a composed
 * manifest is not a guess, it is the lifetime `composeManifests` will register — and a singleton in
 * a library freezing a per-scope value is the same production bug wherever the file lives. The
 * suppression path has to work for them too, and it does: an app's `registrations` block addresses
 * composed contracts by the same (contract, implementation) pair it uses for local ones, so the
 * escape hatch is reachable rather than nominal. Lookup goes through whichever map holds the unit.
 */
const inversionSuppressedForEdge = (
  edge: DemandEdge,
  index: ScopeRootSupplyIndex,
  config: IocConfig | undefined,
): boolean => {
  const registrationKey = edge.unit.registrationKey;
  if (registrationKey === undefined) {
    return false;
  }
  const local = index.factoryByRegistrationKey.get(registrationKey);
  if (local !== undefined) {
    return isLifetimeInversionSuppressed(local, edge.key, config);
  }
  const composed = index.composedUnitByRegistrationKey.get(registrationKey);
  if (composed === undefined) {
    return false;
  }
  return isLifetimeInversionSuppressed(
    {
      contractName: composed.contractName,
      implementationName: composed.implementationName,
    },
    edge.key,
    config,
  );
};

/** A demanding unit reduced to the identity a reported demand carries. */
const demandedByOf = (
  unit: DemandingUnit,
): { exportName: string; modulePath: string; packageName?: string } => ({
  exportName: unit.exportName,
  modulePath: unit.modulePath,
  ...(unit.packageName !== undefined ? { packageName: unit.packageName } : {}),
});

/**
 * Verifies ONE variant's declared lbv against ONE variant's subtree.
 *
 * The variant is the parameter, deliberately: satisfaction is a property of a variant, and nothing
 * in this function has access to — or could combine — the lbv sets of the root contract's other
 * variants.
 */
export const verifyScopeRootVariant = (
  variant: DiscoveredScopeRoot,
  ctx: ScopeRootVerificationContext,
  index: ScopeRootSupplyIndex = buildScopeRootSupplyIndex(ctx),
): ScopeRootVariantVerification => {
  const checker = ctx.program.getTypeChecker();
  const findings: ScopeRootFinding[] = [];

  // The declared lbv meets the checker in `declaredLbv.ts` and nowhere else. The raw node stays on
  // the record; the keys are local to this check and are never written back. A variant that
  // declared its lbv by omission answers with an empty set here, like any other empty declaration.
  const declaredLbv = readDeclaredLbv(checker, variant);
  const declaredKeys = declaredLbv.members.map((m) => m.key);
  const declaredTypeByKey = new Map(
    declaredLbv.members.map((m) => [m.key, m.type] as const),
  );

  // The declaration is read before the walk, because declaring a key IS what makes it a
  // scope-demand for this variant rather than an external the root container supplies.
  const walk = walkSubtree(variant, index, new Set(declaredKeys));

  const demandsByKey = new Map<string, ScopeRootScopeDemand>();
  const seenMismatch = new Set<string>();

  for (const edge of walk.scopeDemandEdges) {
    const supplied = declaredTypeByKey.get(edge.key);

    if (supplied === undefined) {
      if (!demandsByKey.has(edge.key)) {
        demandsByKey.set(edge.key, {
          key: edge.key,
          viaPath: edge.viaPath,
          demandedBy: demandedByOf(edge.unit),
          satisfiedBy: "undeclared",
        });
        findings.push({
          severity: "error",
          code: "lbv_missing_key",
          key: edge.key,
          message: formatMissingKeyError(ctx, variant, edge),
        });
      }
      continue;
    }

    const demanded = demandedTypeAtSite(ctx, checker, edge.unit, edge.key);

    // supplied extends demanded — the externals-check direction, never the inverse.
    const assignable =
      demanded === undefined || checker.isTypeAssignableTo(supplied, demanded);

    if (!assignable && !seenMismatch.has(edge.key)) {
      seenMismatch.add(edge.key);
      findings.push({
        severity: "error",
        code: "lbv_type_mismatch",
        key: edge.key,
        message: formatTypeMismatchError(
          ctx,
          variant,
          edge,
          typeText(checker, supplied),
          typeText(checker, demanded!),
        ),
      });
    }

    const existing = demandsByKey.get(edge.key);
    if (existing === undefined || (existing.satisfiedBy === "declared-lbv" && !assignable)) {
      demandsByKey.set(edge.key, {
        key: edge.key,
        viaPath: edge.viaPath,
        demandedBy: demandedByOf(edge.unit),
        satisfiedBy: assignable ? "declared-lbv" : "type-mismatch",
        suppliedTypeText: typeText(checker, supplied),
        ...(demanded !== undefined
          ? { demandedTypeText: typeText(checker, demanded) }
          : {}),
      });
    }
  }

  const demandedKeys = new Set(demandsByKey.keys());
  const unusedDeclaredKeys = declaredKeys
    .filter((key) => !demandedKeys.has(key))
    .sort((a, b) => a.localeCompare(b));

  for (const key of unusedDeclaredKeys) {
    findings.push({
      severity: "warn",
      code: "lbv_unused_key",
      key,
      // Only a real registration/group makes the "already supplied" note true; the classifier's
      // `external` fallback covers keys nothing anywhere mentions, which is a different story.
      message: formatUnusedKeyWarning(
        ctx,
        variant,
        key,
        classifyDemandedKey(key, index, new Set()).kind === "registrations",
      ),
    });
  }

  // The blind spot behind every verdict above. Emitted once per variant regardless of how many
  // keys it touches — it is a statement about the walk, not about a key — and keyed on the empty
  // string for the same reason. It is deliberately raised even when the variant looks clean: a
  // clean verdict over a subtree that could not be fully walked is exactly the false confidence
  // this advisory exists to qualify.
  if (walk.blindComposedPackages.length > 0) {
    findings.push({
      severity: "warn",
      code: "lbv_composed_blind_spot",
      key: "",
      message: formatComposedBlindSpotAdvisory(
        ctx,
        variant,
        walk.blindComposedPackages,
      ),
    });
  }

  // Lifetime-inversion walk over the subgraph (design doc: deferred by stage 1, owned by stage 2).
  //
  // Two edge kinds matter here and are not already covered by the global check:
  //   1. the scope-root unit itself as a consumer — it is not in `acceptedFactories`, so the global
  //      pass never sees it;
  //   2. any subtree unit consuming one of THIS variant's late-bound values, which is per-scope by
  //      declaration and therefore scoped for ranking purposes.
  for (const edge of walk.scopeDemandEdges) {
    // Undeclared keys already carry their own error; ranking a lifetime against a value the
    // declaration never promised would report one root cause twice.
    if (demandsByKey.get(edge.key)?.satisfiedBy === "undeclared") {
      continue;
    }
    const severity = inversionSeverity(edge.unit.lifetime, "scoped");
    if (severity === undefined) {
      continue;
    }
    if (inversionSuppressedForEdge(edge, index, ctx.config)) {
      continue;
    }
    findings.push({
      severity,
      code: "lifetime_inversion",
      key: edge.key,
      message: formatScopeRootInversion(
        ctx,
        variant,
        edge.unit,
        edge.key,
        "scoped",
        edge.viaPath,
        true,
      ),
    });
  }

  for (const edge of walk.registeredEdges) {
    // Only the scope-root unit's own edges: everything below it is an ordinary factory pair the
    // global lifetime-inversion pass already reports, and re-reporting would duplicate it.
    if (edge.unit.registrationKey !== undefined) {
      continue;
    }
    const severity = inversionSeverity(edge.unit.lifetime, edge.depLifetime);
    if (severity === undefined) {
      continue;
    }
    findings.push({
      severity,
      code: "lifetime_inversion",
      key: edge.key,
      message: formatScopeRootInversion(
        ctx,
        variant,
        edge.unit,
        edge.key,
        edge.depLifetime,
        edge.viaPath,
        false,
      ),
    });
  }

  const scopeDemands = Array.from(demandsByKey.values()).sort((a, b) =>
    a.key.localeCompare(b.key),
  );

  const generationResolvedByKey = new Map<
    string,
    ScopeRootGenerationResolvedKey
  >();
  for (const edge of walk.generationResolvedGroupEdges) {
    if (generationResolvedByKey.has(edge.key)) {
      continue;
    }
    generationResolvedByKey.set(edge.key, {
      key: edge.key,
      via: "group",
      viaPath: edge.viaPath,
      demandedBy: demandedByOf(edge.unit),
    });
  }

  return {
    contractName: variant.contractName,
    variantName: variant.variantName,
    exportName: variant.exportName,
    modulePath: variant.modulePath,
    declaredLbv: variant.lbvTypeText,
    declaredKeys: [...declaredKeys].sort((a, b) => a.localeCompare(b)),
    subtreeUnits: walk.subtreeUnits,
    scopeDemands,
    generationResolvedKeys: Array.from(generationResolvedByKey.values()).sort(
      (a, b) => a.key.localeCompare(b.key),
    ),
    unusedDeclaredKeys,
    blindComposedPackages: walk.blindComposedPackages,
    findings,
    satisfied: !findings.some((f) => f.severity === "error"),
  };
};

/**
 * Verifies every discovered scope-root variant independently.
 *
 * Variants of one root contract are checked one at a time and never merged: two variants of
 * `IRouter` with disjoint lbv sets each stand or fall on their own declaration.
 */
export const verifyScopeRoots = (
  scopeRoots: readonly DiscoveredScopeRoot[],
  ctx: ScopeRootVerificationContext,
): ScopeRootVerificationResult => {
  if (scopeRoots.length === 0) {
    return { variants: [], errors: [], warnings: [] };
  }

  const index = buildScopeRootSupplyIndex(ctx);
  const variants = scopeRoots.map((variant) =>
    verifyScopeRootVariant(variant, ctx, index),
  );

  const errors: string[] = [];
  const warnings: string[] = [];
  for (const variant of variants) {
    for (const finding of variant.findings) {
      (finding.severity === "error" ? errors : warnings).push(finding.message);
    }
  }

  return { variants, errors, warnings };
};

/**
 * Generation-time entry point: warns, then throws one aggregated error carrying every offending
 * variant — the same offender-bucket shape discovery uses for invalid annotations and wrong-arity
 * markers, so one run surfaces every failure instead of the first.
 *
 * `tolerateInvalidAnnotations` mirrors discovery's flag: `ioc inspect --discovery` needs the full
 * offender list in the report rather than an exception. (The design doc does not name the flag for
 * stage 2; this follows the established discovery convention — see the report-back notes.)
 */
export const verifyScopeRootsAtCodegen = (
  scopeRoots: readonly DiscoveredScopeRoot[],
  ctx: ScopeRootVerificationContext,
  runOptions?: { tolerateInvalidAnnotations?: boolean },
): ScopeRootVerificationResult => {
  const result = verifyScopeRoots(scopeRoots, ctx);

  for (const warning of result.warnings) {
    console.warn(warning);
  }

  if (
    result.errors.length > 0 &&
    runOptions?.tolerateInvalidAnnotations !== true
  ) {
    throw new Error(
      [
        `[ioc] ${result.errors.length} scope-root verification failure(s). A scope root's declared late-bound-value set must satisfy every demand its resolution subtree makes that no manifest registration supplies:`,
        ...result.errors,
      ].join("\n"),
    );
  }

  return result;
};
