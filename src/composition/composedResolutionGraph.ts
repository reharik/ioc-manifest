/**
 * @fileoverview The composed resolution graph: every registration in the composed set, every edge
 * between them, and every scope boundary a path can cross.
 *
 * ### Why composition needs a graph at all
 *
 * Every cross-manifest check before this one asked a question about a KEY — is it supplied, is it
 * claimed twice, is its default ambiguous. Scope-reachability is the first question about a PATH:
 * an external is a composition-level obligation only if some resolution path reaches it without
 * crossing a scope boundary, and there is no way to ask that of one key in isolation.
 *
 * ### Where the data comes from
 *
 * All of it is already on the slices, except one field. A manifest records each unit's
 * `dependencyKeys`, which is how an external is detected in the first place; it records group
 * membership; it records `scopeRoots` with each variant's declared late-bound-value set. The one
 * thing it does not record is a VARIANT's own demand set — a variant is not a `contracts` unit and
 * claims no registration key — so that is read from source here, through the same binding-pattern
 * rules discovery uses, against the one program the composition suite already builds. Both verbs
 * reach this module with the same program shape, so neither can read a different answer.
 *
 * ### Where it is deliberately blind
 *
 * A walk is only as complete as the demand data under it, and three things make it incomplete: a
 * manifest that does not claim `dependencyKeysComplete`, a scope-root variant in a COMPOSED package
 * (whose source is not in this program, so its subtree cannot be entered), and a local variant whose
 * deps parameter cannot be read. Each is recorded in {@link ComposedResolutionGraph.blindSpots},
 * and a non-empty set means reachability is not a verdict — callers fall back to treating every
 * external as root-resolvable, which is what they did before this module existed. Silence would be
 * the dangerous direction: an obligation dropped because a demand was invisible looks exactly like
 * an obligation that was never owed.
 */
import ts from "typescript";
import path from "node:path";
import { resolveManifestAccessKey } from "../core/contractAccessKey.js";
import { getBindingPatternPropertyNames } from "../generator/discoverFactories/inferFactoryDependencyContracts.js";
import { unitDepsSignatureDecl } from "../generator/discoverFactories/contractSite.js";
import { collectFileAnalysisForFactoryDiscovery } from "../generator/discoverFactories/scanFactoryFile.js";
import { resolveFactorySourceAbsPath } from "../generator/manifestPaths.js";
import {
  electedImplementationName,
  groupedContractNamesAcrossSlices,
  mergedRowsForContract,
  composedContractNamesSorted,
} from "./checks/composedContractRows.js";
import type { CompositionProgramContext } from "./compositionProgram.js";
import { isLocalSlice, sliceLabel } from "./sliceLabel.js";
import type {
  CompositionContext,
  ParsedScopeRootVariant,
} from "./types.js";

/** The local package is always slice 0 — `loadCompositionContext` builds it that way. */
const LOCAL_SLICE_INDEX = 0;

/** One registration in the composed container, with the demand set its manifest recorded. */
export type ComposedGraphUnit = {
  readonly registrationKey: string;
  readonly contractName: string;
  readonly implementationName: string;
  readonly exportName: string;
  readonly modulePath: string;
  /** Display label of the slice that registers it. */
  readonly packageLabel: string;
  readonly sourceId: string;
  /** Index into `ctx.slices`; `0` is the local package. */
  readonly sliceIndex: number;
  readonly dependencyKeys: readonly string[];
};

/** One scope boundary a resolution path can cross. */
export type ComposedGraphVariant = {
  readonly contractName: string;
  readonly variantName: string;
  readonly exportName: string;
  readonly modulePath: string;
  readonly openerKey: string;
  readonly packageLabel: string;
  readonly sourceId: string;
  readonly sliceIndex: number;
  /** The variant's DECLARED late-bound-value set, verbatim from its manifest row. */
  readonly declaredLbvKeys: readonly string[];
  /** Read from source. `undefined` when the deps parameter could not be read — a blind spot. */
  readonly dependencyKeys: readonly string[] | undefined;
};

/**
 * A demand nothing in the composed container supplies, at the end of one walked path.
 *
 * Every external is one of these, and so is every late-bound value and every key nobody supplies at
 * all. The walk does not decide which it is — it records where the path ran out and how it got
 * there, and the checks that own those rules read it back by key.
 */
export type UnsuppliedDemand = {
  readonly key: string;
  readonly demandedBy: ComposedGraphUnit;
  /** The walk's seed first, then each registration key stepped through. The key itself is not in it. */
  readonly via: readonly string[];
};

/** One variant's subtree, as the walk found it. */
export type VariantSubtree = {
  readonly variant: ComposedGraphVariant;
  /** Registration keys the subtree covers. */
  readonly units: ReadonlySet<string>;
  readonly unsuppliedDemands: readonly UnsuppliedDemand[];
};

export type ComposedResolutionGraph = {
  readonly unitByRegistrationKey: ReadonlyMap<string, ComposedGraphUnit>;
  /** Contract slot keys — `aliasTo(elected)` at runtime — by access key. */
  readonly registrationKeyByAccessKey: ReadonlyMap<string, string>;
  /** Group root keys to their member registration keys, merged across slices. */
  readonly memberKeysByGroupKey: ReadonlyMap<string, readonly string[]>;
  readonly variants: readonly ComposedGraphVariant[];
  /** One subtree per variant, in `variants` order. */
  readonly variantSubtrees: readonly VariantSubtree[];
  /**
   * Demands reached WITHOUT crossing a scope boundary, from the local package's own registrations.
   *
   * The seed set is the local slice's units minus everything some variant's subtree already covers:
   * a registration that exists only to be resolved under a scope root is not something the root
   * container is ever asked for, and seeding the walk with it would manufacture a root path for
   * every late-bound value under every scope in the app.
   */
  readonly rootUnsuppliedDemands: readonly UnsuppliedDemand[];
  /**
   * Why this graph is not a complete description of the composed set, one sentence each.
   *
   * Empty means the walk is total and its answers are verdicts. Non-empty means they are not, and
   * every caller must fall back to the pre-reachability behaviour rather than act on a gap.
   */
  readonly blindSpots: readonly string[];
};

/**
 * The keys one unit demands, as the manifest recorded them.
 *
 * `undefined` and `[]` are the same thing at this layer and deliberately so: a manifest that omits
 * the field on a unit is indistinguishable from one whose unit demands nothing, which is exactly
 * what the `dependencyKeysComplete` feature token exists to tell a reader. The blind-spot set
 * carries that distinction; the edge list cannot represent it.
 */
const dependencyKeysOf = (meta: {
  readonly dependencyKeys?: readonly string[];
}): readonly string[] => meta.dependencyKeys ?? [];

const unitsFromSlices = (
  ctx: CompositionContext,
): Map<string, ComposedGraphUnit> => {
  const byRegistrationKey = new Map<string, ComposedGraphUnit>();

  // Local first, and locals win: `registerIocFromManifest` registers the local manifest last, and a
  // genuine collision between a local and a composed registration is `same-key-conflict`'s finding
  // to report — not a fact this graph should quietly resolve one way and then reason from.
  ctx.slices.forEach((slice, sliceIndex) => {
    for (const [contractName, impls] of Object.entries(slice.contracts)) {
      for (const [implementationName, meta] of Object.entries(impls)) {
        if (byRegistrationKey.has(meta.registrationKey)) {
          continue;
        }
        byRegistrationKey.set(meta.registrationKey, {
          registrationKey: meta.registrationKey,
          contractName,
          implementationName,
          exportName: meta.exportName ?? implementationName,
          modulePath: meta.modulePath ?? "",
          packageLabel: sliceLabel(slice),
          sourceId: slice.sourceId,
          sliceIndex,
          dependencyKeys: dependencyKeysOf(meta),
        });
      }
    }
  });

  return byRegistrationKey;
};

/**
 * Contract slot keys across the composed set, through the same election the slot checks read.
 *
 * A contract with no resolvable election contributes no slot: `default-ambiguity` reports that, and
 * a slot key nobody can be named under is a key the container will not have either. Grouped
 * contracts contribute none for the same reason `slot-occupancy` skips them — grouped ⇒ group-only,
 * so there is no individual slot to alias.
 */
const accessKeysFromSlices = (
  ctx: CompositionContext,
): Map<string, string> => {
  const grouped = groupedContractNamesAcrossSlices(ctx);
  const byAccessKey = new Map<string, string>();

  for (const contractName of composedContractNamesSorted(ctx)) {
    if (grouped.has(contractName)) {
      continue;
    }
    const merged = mergedRowsForContract(ctx, contractName);
    const elected = electedImplementationName(ctx, contractName, merged);
    if (elected === undefined) {
      continue;
    }
    const electedRow = merged.rows.find(
      (row) => row.implementationName === elected,
    );
    if (electedRow === undefined) {
      continue;
    }
    const accessKey = resolveManifestAccessKey(
      contractName,
      ctx.slices.flatMap((slice) =>
        Object.values(slice.contracts[contractName] ?? {}),
      ),
    );
    if (!byAccessKey.has(accessKey)) {
      byAccessKey.set(accessKey, electedRow.registrationKey);
    }
  }

  return byAccessKey;
};

/** Member registration keys of a parsed group node, for both group kinds. */
const memberRegistrationKeys = (members: unknown): string[] => {
  const leaves: unknown[] = Array.isArray(members)
    ? members
    : typeof members === "object" && members !== null
      ? Object.values(members)
      : [];
  return leaves
    .map((leaf) =>
      typeof leaf === "object" &&
      leaf !== null &&
      typeof (leaf as { registrationKey?: unknown }).registrationKey === "string"
        ? (leaf as { registrationKey: string }).registrationKey
        : undefined,
    )
    .filter((key): key is string => key !== undefined);
};

/**
 * Group roots merge across manifests rather than shadow one another, exactly as `composeManifests`
 * merges them — so a key present in two slices resolves to the union of both member lists, which is
 * the collection the cradle actually hands out.
 */
const groupMembersFromSlices = (
  ctx: CompositionContext,
): Map<string, readonly string[]> => {
  const byGroupKey = new Map<string, readonly string[]>();
  for (const slice of ctx.slices) {
    for (const [groupKey, root] of Object.entries(slice.groupRoots)) {
      const existing = byGroupKey.get(groupKey) ?? [];
      const additions = memberRegistrationKeys(root.members).filter(
        (key) => !existing.includes(key),
      );
      byGroupKey.set(groupKey, [...existing, ...additions]);
    }
  }
  return byGroupKey;
};

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
      program
        .getSourceFiles()
        .map((sf) => [path.normalize(sf.fileName), sf] as const),
    );
    sourceFileIndexByProgram.set(program, index);
  }
  return index.get(path.normalize(absPath));
};

/**
 * A scope-root variant's own demand set, read from the source the manifest points at.
 *
 * `undefined` means it could not be read, which is a blind spot and never "demands nothing" — a
 * variant whose deps are invisible has an invisible subtree, and a subtree nobody walked must not
 * be reported as one that reaches nothing.
 */
const variantDependencyKeys = (
  ctx: CompositionContext,
  programCtx: CompositionProgramContext | undefined,
  variant: ParsedScopeRootVariant,
): readonly string[] | undefined => {
  if (programCtx === undefined) {
    return undefined;
  }
  const sourceFile = sourceFileAt(
    programCtx.program,
    resolveFactorySourceAbsPath(
      variant.modulePath,
      ctx.projectRoot,
      ctx.scanDirs,
    ),
  );
  if (sourceFile === undefined) {
    return undefined;
  }
  const decl = collectFileAnalysisForFactoryDiscovery(
    sourceFile,
  ).unitDeclByExport.get(variant.exportName);
  if (decl === undefined) {
    return undefined;
  }
  const signature = unitDepsSignatureDecl(decl);
  if (signature === undefined) {
    // A class with no constructor takes nothing from the cradle. Determined, and empty.
    return [];
  }
  const paramNode = signature.parameters[0];
  if (paramNode === undefined) {
    return [];
  }
  if (!ts.isObjectBindingPattern(paramNode.name)) {
    return undefined;
  }
  const names = getBindingPatternPropertyNames(paramNode.name);
  return Array.isArray(names) ? names : undefined;
};

const variantsFromSlices = (
  ctx: CompositionContext,
  programCtx: CompositionProgramContext | undefined,
): ComposedGraphVariant[] => {
  const variants: ComposedGraphVariant[] = [];
  ctx.slices.forEach((slice, sliceIndex) => {
    for (const byVariant of Object.values(slice.scopeRoots)) {
      for (const variant of Object.values(byVariant)) {
        variants.push({
          contractName: variant.contractName,
          variantName: variant.variantName,
          exportName: variant.exportName,
          modulePath: variant.modulePath,
          openerKey: variant.openerKey,
          packageLabel: sliceLabel(slice),
          sourceId: slice.sourceId,
          sliceIndex,
          declaredLbvKeys: variant.lbvKeys,
          // Only a LOCAL variant's source is in this program. A composed package's is not, and
          // pretending otherwise would read `undefined` as "demands nothing" for every one of them.
          dependencyKeys: isLocalSlice(slice)
            ? variantDependencyKeys(ctx, programCtx, variant)
            : undefined,
        });
      }
    }
  });
  return variants;
};

const DEPENDENCY_KEYS_COMPLETE = "dependencyKeysComplete";

const blindSpotsFor = (
  ctx: CompositionContext,
  variants: readonly ComposedGraphVariant[],
  localUnitCount: number,
): string[] => {
  const reasons: string[] = [];

  // An app that registers nothing of its own gives the root walk no seeds at all, and a walk with
  // no seeds reaches nothing BY CONSTRUCTION. Reading that as "no path reaches this key" would clear
  // every external in the composed set on the strength of having looked nowhere — which is exactly
  // the pure-composition app whose externals matter most. Zero seeds is no information, not a
  // verdict of zero obligations.
  if (localUnitCount === 0) {
    reasons.push(
      `${sliceLabel(ctx.slices[0]!)} registers nothing of its own, so no resolution path can be walked from it.`,
    );
  }

  for (const slice of ctx.slices) {
    if (slice.declaredFeatures?.includes(DEPENDENCY_KEYS_COMPLETE) === true) {
      continue;
    }
    reasons.push(
      `${sliceLabel(slice)} does not declare "${DEPENDENCY_KEYS_COMPLETE}", so its units' demands may be incomplete.`,
    );
  }

  for (const variant of variants) {
    if (variant.dependencyKeys !== undefined) {
      continue;
    }
    reasons.push(
      `Scope root "${variant.contractName}" variant "${variant.variantName}" (${variant.packageLabel}) could not have its demand set read, so its subtree could not be walked.`,
    );
  }

  return reasons;
};

/** The registration keys a demanded key resolves to, in the container's own precedence. */
const registrationsSupplyingKey = (
  key: string,
  graph: {
    readonly unitByRegistrationKey: ReadonlyMap<string, ComposedGraphUnit>;
    readonly registrationKeyByAccessKey: ReadonlyMap<string, string>;
    readonly memberKeysByGroupKey: ReadonlyMap<string, readonly string[]>;
  },
): readonly string[] => {
  const groupMembers = graph.memberKeysByGroupKey.get(key);
  if (groupMembers !== undefined) {
    return groupMembers;
  }
  if (graph.unitByRegistrationKey.has(key)) {
    return [key];
  }
  const viaAccessKey = graph.registrationKeyByAccessKey.get(key);
  return viaAccessKey !== undefined ? [viaAccessKey] : [];
};

/**
 * Breadth-first walk from a seed set, recording every demand the container cannot supply.
 *
 * One implementation for both walks. What makes a walk a SCOPE walk rather than a ROOT walk is
 * entirely its seeds — the variant's own demands versus the local package's un-scoped registrations
 * — and nothing else about the traversal differs. Writing it twice would be writing two subtly
 * different ideas of what a resolution path is.
 */
const walkFrom = (
  seeds: readonly { readonly key: string; readonly via: readonly string[] }[],
  graph: {
    readonly unitByRegistrationKey: ReadonlyMap<string, ComposedGraphUnit>;
    readonly registrationKeyByAccessKey: ReadonlyMap<string, string>;
    readonly memberKeysByGroupKey: ReadonlyMap<string, readonly string[]>;
  },
  seedDemandedBy: ReadonlyMap<string, ComposedGraphUnit> | undefined,
): { units: Set<string>; unsuppliedDemands: UnsuppliedDemand[] } => {
  const units = new Set<string>();
  const unsuppliedDemands: UnsuppliedDemand[] = [];
  const queue: { unit: ComposedGraphUnit; via: readonly string[] }[] = [];

  const enqueue = (key: string, via: readonly string[]): void => {
    for (const target of registrationsSupplyingKey(key, graph)) {
      if (units.has(target)) {
        continue;
      }
      const unit = graph.unitByRegistrationKey.get(target);
      if (unit === undefined) {
        continue;
      }
      units.add(target);
      queue.push({ unit, via: [...via, target] });
    }
  };

  for (const seed of seeds) {
    const supplying = registrationsSupplyingKey(seed.key, graph);
    if (supplying.length > 0) {
      enqueue(seed.key, seed.via);
      continue;
    }
    const demander = seedDemandedBy?.get(seed.key);
    if (demander !== undefined) {
      unsuppliedDemands.push({ key: seed.key, demandedBy: demander, via: seed.via });
    }
  }

  while (queue.length > 0) {
    const { unit, via } = queue.shift()!;
    for (const key of unit.dependencyKeys) {
      if (registrationsSupplyingKey(key, graph).length === 0) {
        unsuppliedDemands.push({ key, demandedBy: unit, via });
        continue;
      }
      enqueue(key, via);
    }
  }

  return { units, unsuppliedDemands };
};

/**
 * The composed resolution graph for one composition context.
 *
 * Built once per run by `runCompositionChecks` and shared, for the same reason the TypeScript
 * program is: two constructions of the graph are two chances for two checks to disagree about the
 * shape of the thing they are both judging.
 */
export const buildComposedResolutionGraph = (
  ctx: CompositionContext,
  programCtx: CompositionProgramContext | undefined,
): ComposedResolutionGraph => {
  const unitByRegistrationKey = unitsFromSlices(ctx);
  const registrationKeyByAccessKey = accessKeysFromSlices(ctx);
  const memberKeysByGroupKey = groupMembersFromSlices(ctx);
  const variants = variantsFromSlices(ctx, programCtx);
  const indexes = {
    unitByRegistrationKey,
    registrationKeyByAccessKey,
    memberKeysByGroupKey,
  };

  const variantSubtrees: VariantSubtree[] = variants.map((variant) => {
    const demandedBy = new Map<string, ComposedGraphUnit>();
    // The variant itself is the demanding site for its own edges. It claims no registration key, so
    // it enters the record as a unit whose key is its variant name — the same stand-in the codegen
    // walk uses when it has to name the root of a path.
    const variantAsUnit: ComposedGraphUnit = {
      registrationKey: variant.variantName,
      contractName: variant.contractName,
      implementationName: variant.variantName,
      exportName: variant.exportName,
      modulePath: variant.modulePath,
      packageLabel: variant.packageLabel,
      sourceId: variant.sourceId,
      sliceIndex: variant.sliceIndex,
      dependencyKeys: variant.dependencyKeys ?? [],
    };
    for (const key of variantAsUnit.dependencyKeys) {
      demandedBy.set(key, variantAsUnit);
    }
    const walk = walkFrom(
      variantAsUnit.dependencyKeys.map((key) => ({
        key,
        via: [variant.variantName],
      })),
      indexes,
      demandedBy,
    );
    return {
      variant,
      units: walk.units,
      unsuppliedDemands: walk.unsuppliedDemands,
    };
  });

  const coveredByAScope = new Set<string>();
  for (const subtree of variantSubtrees) {
    for (const key of subtree.units) {
      coveredByAScope.add(key);
    }
  }

  const rootSeedDemandedBy = new Map<string, ComposedGraphUnit>();
  const rootSeeds: { key: string; via: readonly string[] }[] = [];
  for (const unit of unitByRegistrationKey.values()) {
    if (
      unit.sliceIndex !== LOCAL_SLICE_INDEX ||
      coveredByAScope.has(unit.registrationKey)
    ) {
      continue;
    }
    rootSeeds.push({ key: unit.registrationKey, via: [] });
    rootSeedDemandedBy.set(unit.registrationKey, unit);
  }
  const rootWalk = walkFrom(rootSeeds, indexes, rootSeedDemandedBy);

  return {
    unitByRegistrationKey,
    registrationKeyByAccessKey,
    memberKeysByGroupKey,
    variants,
    variantSubtrees,
    rootUnsuppliedDemands: rootWalk.unsuppliedDemands,
    blindSpots: blindSpotsFor(
      ctx,
      variants,
      [...unitByRegistrationKey.values()].filter(
        (unit) => unit.sliceIndex === LOCAL_SLICE_INDEX,
      ).length,
    ),
  };
};

/** One variant the obligation for a scope-reachable key propagates to. */
export type ScopeVariantReach = {
  readonly variant: ComposedGraphVariant;
  readonly demand: UnsuppliedDemand;
  /** True when this variant's declared late-bound-value set (or config) already names the key. */
  readonly satisfied: boolean;
};

/**
 * How a demanded key is reached, which is what decides WHEN its obligation comes due.
 *
 * - `root` — some path reaches it without crossing a scope boundary. A composition-level external,
 *   judged exactly as every external was judged before this classification existed.
 * - `scope-only` — every path to it crosses a scope boundary. Not a composition-level obligation at
 *   all; it propagates to the variants that reach it and is settled there.
 * - `mixed` — both. The root path is still unsatisfiable, and the scope paths do not launder it.
 * - `unreachable` — nothing in this composition resolves through it. No obligation: a consumer that
 *   composes a package and never resolves the part of it that demands the key owes nothing.
 * - `unknown` — the walk is incomplete, so none of the above is a verdict. Callers fall back.
 */
export type ExternalKeyReachability =
  | { readonly kind: "unknown"; readonly blindSpots: readonly string[] }
  | { readonly kind: "unreachable" }
  | { readonly kind: "root"; readonly rootDemands: readonly UnsuppliedDemand[] }
  | { readonly kind: "scope-only"; readonly reaches: readonly ScopeVariantReach[] }
  | {
      readonly kind: "mixed";
      readonly rootDemands: readonly UnsuppliedDemand[];
      readonly reaches: readonly ScopeVariantReach[];
    };

/**
 * Classifies one external key by reachability, restricted to the slice that DEMANDS it.
 *
 * The restriction matters: two packages can declare the same external, and each one's obligation is
 * about its own units. A demand site in another package is that package's finding, reached by its
 * own paths, and folding the two together would report one package's unsatisfiable root path
 * against the other's name.
 */
export const classifyExternalReachability = (
  graph: ComposedResolutionGraph,
  key: string,
  demandingSliceIndex: number,
  scopeProvidedKeys: ReadonlySet<string>,
): ExternalKeyReachability => {
  if (graph.blindSpots.length > 0) {
    return { kind: "unknown", blindSpots: graph.blindSpots };
  }

  const rootDemands = graph.rootUnsuppliedDemands.filter(
    (demand) =>
      demand.key === key &&
      demand.demandedBy.sliceIndex === demandingSliceIndex,
  );

  // Per VARIANT, never per root contract. Variants of one contract differ in their declared sets,
  // therefore in their subtrees, therefore in what they reach — asking a variant for a key its own
  // subtree never resolves is a demand for a value it has no use for.
  const reaches: ScopeVariantReach[] = [];
  for (const subtree of graph.variantSubtrees) {
    const demand = subtree.unsuppliedDemands.find(
      (candidate) =>
        candidate.key === key &&
        candidate.demandedBy.sliceIndex === demandingSliceIndex,
    );
    if (demand === undefined) {
      continue;
    }
    reaches.push({
      variant: subtree.variant,
      demand,
      satisfied:
        subtree.variant.declaredLbvKeys.includes(key) ||
        scopeProvidedKeys.has(key),
    });
  }

  if (rootDemands.length > 0 && reaches.length > 0) {
    return { kind: "mixed", rootDemands, reaches };
  }
  if (rootDemands.length > 0) {
    return { kind: "root", rootDemands };
  }
  if (reaches.length > 0) {
    return { kind: "scope-only", reaches };
  }
  return { kind: "unreachable" };
};
