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
 * lbv resolution discipline: the record keeps the raw `ts.TypeNode` captured at stage 1 and keeps it
 * forever. The checker is applied to it here, at the boundary, and the resolved type never travels
 * back into a {@link DiscoveredScopeRoot}. Demanded types are resolved the same way — lazily, and
 * only for the keys that turn out to be scope-demands.
 */
import path from "node:path";
import ts from "typescript";
import type { IocConfig, IocLifetime } from "../config/iocConfig.js";
import type { IocGroupsManifest } from "../core/manifest.js";
import { unitDepsSignatureDecl } from "./discoverFactories/contractSite.js";
import { collectFileAnalysisForFactoryDiscovery } from "./discoverFactories/scanFactoryFile.js";
import {
  resolveFactorySourceAbsPath,
  type FactoryDiscoveryPaths,
} from "./manifestPaths.js";
import type { ResolvedContractRegistration } from "./resolveRegistrationPlan.js";
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
  | "lifetime_inversion";

export type ScopeRootFinding = {
  severity: "error" | "warn";
  code: ScopeRootFindingCode;
  /** The demanded or declared key the finding is about. */
  key: string;
  message: string;
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
  demandedBy: { exportName: string; modulePath: string };
};

/**
 * One key demanded under a variant's subtree that must enter at the scope boundary — neither a
 * manifest registration, a group key, nor an external supplies it.
 */
export type ScopeRootScopeDemand = {
  key: string;
  /** Variant name first, then the registration keys walked to reach the demanding unit. */
  viaPath: readonly string[];
  demandedBy: { exportName: string; modulePath: string };
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
  /** Scope-demands of this variant's subtree, sorted by key. */
  scopeDemands: readonly ScopeRootScopeDemand[];
  /**
   * Container-supplied keys this caller could not expand but generation resolves, sorted by key.
   * Empty at generation; populated for inspection, which has no group plan.
   */
  generationResolvedKeys: readonly ScopeRootGenerationResolvedKey[];
  /** Declared lbv keys the subtree never demands (dead weight on the boundary contract). */
  unusedDeclaredKeys: readonly string[];
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
};

const normalizePath = (p: string): string => path.normalize(p);

const relModulePath = (projectRoot: string, modulePath: string): string =>
  path
    .relative(projectRoot, path.join(projectRoot, modulePath))
    .replace(/\\/g, "/");

/** Manifest-registration supply, indexed the way the walk consumes it. */
export type ScopeRootSupplyIndex = {
  factoryByRegistrationKey: Map<string, DiscoveredFactory>;
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
};

const groupMemberRegistrationKeys = (
  manifest: IocGroupsManifest[string],
): string[] =>
  Array.isArray(manifest.members)
    ? manifest.members.map((m) => m.registrationKey)
    : Object.values(manifest.members).map((leaf) => leaf.registrationKey);

const buildSupplyIndex = (
  ctx: ScopeRootVerificationContext,
): ScopeRootSupplyIndex => {
  const factoryByRegistrationKey = new Map<string, DiscoveredFactory>();
  for (const factory of ctx.acceptedFactories) {
    factoryByRegistrationKey.set(factory.registrationKey, factory);
  }

  const registrationKeyByAccessKey = new Map<string, string>();
  const lifetimeByRegistrationKey = new Map<string, IocLifetime>();
  for (const plan of ctx.plans) {
    for (const impl of plan.implementations) {
      lifetimeByRegistrationKey.set(impl.registrationKey, impl.lifetime);
    }
    const defaultImpl = plan.implementations.find(
      (impl) => impl.implementationName === plan.defaultImplementationName,
    );
    if (defaultImpl !== undefined) {
      registrationKeyByAccessKey.set(
        plan.accessKey,
        defaultImpl.registrationKey,
      );
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

  return {
    factoryByRegistrationKey,
    registrationKeyByAccessKey,
    lifetimeByRegistrationKey,
    groupMemberKeysByGroupKey,
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
  const groupMembers = index.groupMemberKeysByGroupKey.get(key);
  if (groupMembers !== undefined) {
    return { kind: "registrations", registrationKeys: groupMembers };
  }
  if (index.factoryByRegistrationKey.has(key)) {
    return { kind: "registrations", registrationKeys: [key] };
  }
  const viaAccessKey = index.registrationKeyByAccessKey.get(key);
  if (viaAccessKey !== undefined) {
    return { kind: "registrations", registrationKeys: [viaAccessKey] };
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

/** One (demanding unit, key) pair discovered by the walk. */
type DemandEdge = {
  key: string;
  unit: DemandingUnit;
  /** Variant name first, then registration keys down to `unit`. */
  viaPath: readonly string[];
};

type SubtreeWalk = {
  /** Scope-demand edges: keys that must enter at the boundary. Every occurrence, in BFS order. */
  scopeDemandEdges: readonly DemandEdge[];
  /** Edges whose key resolves to registrations, with the resolved lifetimes (for inversion). */
  registeredEdges: readonly (DemandEdge & {
    depRegistrationKey: string;
    depLifetime: IocLifetime;
  })[];
  /** Group root keys generation resolves that this caller could not expand (inspection). */
  generationResolvedGroupEdges: readonly DemandEdge[];
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
  const scopeDemandEdges: DemandEdge[] = [];
  const generationResolvedGroupEdges: DemandEdge[] = [];
  const registeredEdges: (DemandEdge & {
    depRegistrationKey: string;
    depLifetime: IocLifetime;
  })[] = [];

  const expanded = new Set<string>();
  const queue: { unit: DemandingUnit; viaPath: readonly string[] }[] = [
    { unit: scopeRootAsDemandingUnit(variant), viaPath: [variant.variantName] },
  ];

  while (queue.length > 0) {
    const { unit, viaPath } = queue.shift()!;

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
        if (factory === undefined) {
          continue;
        }
        queue.push({
          unit: factoryAsDemandingUnit(factory, depLifetime ?? "singleton"),
          viaPath: [...viaPath, target],
        });
      }
    }
  }

  return { scopeDemandEdges, registeredEdges, generationResolvedGroupEdges };
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

const demandSiteLabel = (
  ctx: ScopeRootVerificationContext,
  edge: DemandEdge,
): string =>
  `demanded by ${JSON.stringify(edge.unit.exportName)} in ${relModulePath(ctx.projectRoot, edge.unit.modulePath)} (via ${[...edge.viaPath, edge.key].join(" → ")})`;

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
  ].join("\n");

const formatUnusedKeyWarning = (
  ctx: ScopeRootVerificationContext,
  variant: DiscoveredScopeRoot,
  key: string,
  containerSupplied: boolean,
): string =>
  `[ioc] ${variantLabel(ctx, variant)}: declared late-bound value ${JSON.stringify(key)} is never demanded under the root${containerSupplied ? " (a manifest registration already supplies that key, so the scope boundary never carries it)" : ""}. The boundary contract carries dead weight — every opening site must pass a value nothing resolves. Remove it from the declaration, or wire the consumer that was meant to demand it.`;

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
  const consumerSite = `${JSON.stringify(consumer.exportName)} in ${relModulePath(ctx.projectRoot, consumer.modulePath)}`;
  const depPhrase = lbvDeclared
    ? `'${depKey}' (late-bound value of scope root "${variant.contractName}" variant "${variant.variantName}", per-scope)`
    : `'${depKey}' (${depLifetime})`;
  const head = `Lifetime inversion under scope root "${variant.contractName}" variant "${variant.variantName}": '${consumerLabel}' (${consumer.lifetime}, ${consumerSite}) depends on ${depPhrase}.`;
  const detail =
    consumer.lifetime === "singleton"
      ? " A singleton freezes its scoped dependency at first construction, reusing it across every scope opened from this root."
      : " A longer-lived consumer should not depend on a shorter-lived dependency.";
  const trail = ` via ${[...viaPath, depKey].join(" → ")}. Register '${consumerLabel}' as scoped (or shorter), or mark it intentional with registrations['<Contract>'].<impl>.allowLifetimeInversion.`;
  return `[ioc] ${head}${detail}${trail}`;
};

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
  index: ScopeRootSupplyIndex = buildSupplyIndex(ctx),
): ScopeRootVariantVerification => {
  const checker = ctx.program.getTypeChecker();
  const findings: ScopeRootFinding[] = [];

  // The one place the declared lbv meets the checker. The raw node stays on the record; this
  // resolved type is local to the check and is never written back.
  const lbvType = checker.getApparentType(
    checker.getTypeFromTypeNode(variant.lbvTypeNode),
  );
  const declaredKeys = checker
    .getPropertiesOfType(lbvType)
    .map((prop) => prop.getName())
    .filter((name) => !name.startsWith("__"));

  // The declaration is read before the walk, because declaring a key IS what makes it a
  // scope-demand for this variant rather than an external the root container supplies.
  const walk = walkSubtree(variant, index, new Set(declaredKeys));

  const demandsByKey = new Map<string, ScopeRootScopeDemand>();
  const seenMismatch = new Set<string>();

  for (const edge of walk.scopeDemandEdges) {
    const declaredProp = checker.getPropertyOfType(lbvType, edge.key);

    if (declaredProp === undefined) {
      if (!demandsByKey.has(edge.key)) {
        demandsByKey.set(edge.key, {
          key: edge.key,
          viaPath: edge.viaPath,
          demandedBy: {
            exportName: edge.unit.exportName,
            modulePath: edge.unit.modulePath,
          },
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

    const supplied = checker.getTypeOfSymbol(declaredProp);
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
        demandedBy: {
          exportName: edge.unit.exportName,
          modulePath: edge.unit.modulePath,
        },
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
    const owner = index.factoryByRegistrationKey.get(
      edge.unit.registrationKey ?? "",
    );
    if (
      owner !== undefined &&
      isLifetimeInversionSuppressed(owner, edge.key, ctx.config)
    ) {
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
      demandedBy: {
        exportName: edge.unit.exportName,
        modulePath: edge.unit.modulePath,
      },
    });
  }

  return {
    contractName: variant.contractName,
    variantName: variant.variantName,
    exportName: variant.exportName,
    modulePath: variant.modulePath,
    declaredLbv: variant.lbvTypeText,
    declaredKeys: [...declaredKeys].sort((a, b) => a.localeCompare(b)),
    scopeDemands,
    generationResolvedKeys: Array.from(generationResolvedByKey.values()).sort(
      (a, b) => a.key.localeCompare(b.key),
    ),
    unusedDeclaredKeys,
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

  const index = buildSupplyIndex(ctx);
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
