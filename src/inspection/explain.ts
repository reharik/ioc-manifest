/**
 * @fileoverview `ioc explain <key>` — one cradle key, one screen.
 *
 * ### The question this answers
 *
 * `inspect` reports the whole manifest and `inspect --discovery` reports the whole scan. Both are
 * the right shape for "what is in here" and the wrong shape for the question a developer actually
 * arrives with, which is about ONE key: what does `uow` resolve to, why is it scoped, what does it
 * pull in, and who breaks if it changes. Answering that from a full report means reading four
 * sections and joining them by hand.
 *
 * So this builds the join. Every fact it prints is already somewhere in the manifest or the scan;
 * what is new is that they are gathered around a single key, in the order a person asks for them:
 * **what it is**, **how long it lives and who decided that**, **what it depends on**, **who depends
 * on it**.
 *
 * ### The composed picture, when there is one
 *
 * The join above used to stop at the package boundary, which made the command work richly in a
 * library and read as cut off in the app — where most cradle keys are supplied by somebody else and
 * where the question is therefore asked most often. When the caller supplies an
 * {@link ExplainComposedView}, the composed registrations, group roots, slot elections and declared
 * externals are merged into the same universe every section below already reads, so nothing here
 * grows a package-boundary special case: a composed unit is a unit, and it turns up in resolution,
 * in dependencies, in dependents and in scope-root reach by the same code paths a local one does.
 * What it carries extra is its SUPPLIER, and every answer names it.
 *
 * Local wins on a collision, matching the scope-root walk: a local registration and a composed one
 * under the same key is a composition error the suite already reports, and this view must not
 * disagree with discovery about which unit is in front of the reader.
 *
 * ### Read-only, and parse-only
 *
 * Nothing here writes, and nothing here imports the generated manifest — the same discipline
 * `loadManifestForInspection` keeps, for the same reason (the CLI runs under plain `node`).
 *
 * ### Two modes, two depths, stated honestly
 *
 * Manifest mode reads the file on disk; discovery mode re-runs the scan. A manifest records no
 * scope-root subtree, so manifest mode says so rather than guessing — the same stance every other
 * manifest-sourced view in this package takes about the things a manifest cannot know. Lifetime
 * PROVENANCE used to be on that list and no longer is: manifests carry `lifetimeSource` since
 * schema v3, and a manifest written before that is told apart from one whose unit genuinely records
 * nothing by the `IOC_MANIFEST_FEATURES` declaration rather than by guessing from absence.
 */
import type { IocLifetime } from "../config/iocConfig.js";
import type {
  IocContractManifest,
  IocGroupRootManifest,
  IocGroupsManifest,
  IocScopeRootsManifest,
} from "../core/manifest.js";
import { resolveManifestAccessKey } from "../core/contractAccessKey.js";
import { inversionSeverity } from "../generator/validateLifetimeInversionsAtCodegen.js";
import { variantNameToOpenerKey } from "../generator/naming.js";
import { formatFreshnessCaveat } from "../diagnostics/freshness.js";
import type { ComposedGroupKeyHit } from "../composition/composedGroupIndex.js";
import type {
  ComposedExternalRow,
  ExplainComposedView,
  ExplainSupplier,
} from "./explainComposedView.js";
import type { DiscoveryAnalysisResult } from "./runDiscoveryAnalysis.js";

/** Which view produced the report — and therefore which facts could be known at all. */
export type ExplainMode = "manifest" | "discovery";

/** One registered unit, flattened to the fields an explanation needs, from either source. */
export type ExplainUnit = {
  registrationKey: string;
  contractName: string;
  implementationName: string;
  lifetime: string;
  /** `lifetime-marker`, `group-base-marker`, `discovery-root`, `factory-config`, `default`. */
  lifetimeSource?: string;
  modulePath: string;
  exportName: string;
  dependencyKeys: readonly string[];
  /** True when this unit backs its contract's default slot. */
  isDefault: boolean;
  /**
   * The package supplying this unit, when the answer is being given over a composed picture.
   *
   * Absent in library mode, where there is one package and naming it on every line would be noise.
   * That absence is what keeps a purely local explanation byte-identical to what it has always been.
   */
  packageLabel?: string;
  /** The machine token for {@link packageLabel} — `"local"`, or a `composedManifests` entry. */
  sourceId?: string;
};

/** One step of the provenance chain: `scoped ← group-base marker on WriteServiceBase`. */
export type ExplainLifetime = {
  lifetime: string;
  /** Chain steps, nearest cause first. Empty when nothing recorded the decision. */
  provenance: readonly string[];
  /**
   * Why the chain is empty, when the reason is worth acting on.
   *
   * Set only for a supplier whose manifest predates `lifetimeSource`: there the emptiness has a
   * remedy — regenerate that package — and the note names it. Never a guess at what the provenance
   * would have been.
   */
  degradedNote?: string;
};

export type ExplainDependency = {
  key: string;
  /** What the key turned out to be: a registration, a contract slot, a group, an opener, external. */
  resolvedAs: string;
  lifetime?: string;
  /** The package supplying this dependency, over a composed picture. */
  packageLabel?: string;
  /** Set when the floor rule is under pressure on this edge. */
  pressure?: {
    severity: "error" | "warn";
    message: string;
  };
};

export type ExplainDependent = {
  /** The demanding unit's registration key, or its export name when it claims none. */
  demander: string;
  modulePath: string;
  /** `direct`, `group:<groupKey>`, or `slot:<accessKey>`. */
  via: string;
  /** The package the demanding unit lives in, over a composed picture. */
  packageLabel?: string;
};

export type ExplainResolution =
  | { kind: "registration"; unit: ExplainUnit }
  | {
      kind: "contract-slot";
      accessKey: string;
      contractName: string;
      /** The implementation the slot resolves to, when one is elected. */
      electee?: ExplainUnit;
      /** Every implementation of the contract, so a contested slot shows its field. */
      implementations: readonly string[];
    }
  | {
      kind: "group";
      groupName: string;
      groupKind: "collection" | "object";
      baseType: string;
      members: readonly {
        memberName: string;
        registrationKey: string;
        /** The package supplying this member's registration, over a composed picture. */
        packageLabel?: string;
      }[];
      /** The package whose manifest declares this root, over a composed picture. */
      declaredBy?: string;
    }
  | {
      kind: "opener";
      openerKey: string;
      contractName: string;
      variantName: string;
      lbvKeys: readonly string[];
    }
  /**
   * The key names a grouped contract's member, which has no cradle key of its own.
   *
   * The answer-shaped sibling of the `grouped-member-demand` ERROR: the same facts, in the teaching
   * register. A reader who typed this key has a coherent model that happens to be wrong about one
   * rule, and the useful reply states the rule and the spelling that does work — not a miss.
   */
  | {
      kind: "grouped-member";
      groupKey: string;
      groupKind: "collection" | "object";
      baseType: string;
      /** The package whose manifest declares the group root. */
      declaredBy: string;
      /** True when that package is composed rather than the one being explained from. */
      declaredByComposedPackage: boolean;
      /** The member contract this key names, when it names a member rather than the base. */
      contractName?: string;
      /**
       * The record property the group exposes this member under — what a consumer writes after the
       * group key. Absent for a collection group, whose members are anonymous by declaration.
       */
      recordPropertyKey?: string;
    }
  /**
   * Nothing in the composed set registers the key, and at least one package declares it as an
   * external — so it is not a miss but a demand on the composing app, answered as one.
   */
  | {
      kind: "external";
      /** The demanded type as the declaring package's `IocExternals` writes it. */
      typeText?: string;
      /** Every package that expects the container to already carry this key. */
      demandedBy: readonly { packageLabel: string; sourceId: string }[];
    }
  | { kind: "unknown"; similarKeys: readonly string[] };

export type ExplainReport = {
  key: string;
  mode: ExplainMode;
  resolution: ExplainResolution;
  /** Absent for a key with no single unit behind it (a group root, an unknown key). */
  lifetime?: ExplainLifetime;
  /** The package supplying the explained key, over a composed picture. */
  supplier?: { packageLabel: string; sourceId: string };
  /**
   * True when the answer was given over a composed picture rather than this package alone.
   *
   * Rendering reads it to say "nothing in the composed picture" where it would otherwise say
   * "nothing in this package" — in an app the second is true and misleading, because the reader's
   * question was about the container and the container is bigger than the package.
   */
  composed?: true;
  dependencies: readonly ExplainDependency[];
  dependents: readonly ExplainDependent[];
  /** Scope-root variants whose resolution subtree reaches this key. Discovery mode only. */
  scopeRootSubtrees: readonly {
    contractName: string;
    variantName: string;
    openerKey: string;
  }[];
  /**
   * The `sourceId`s this answer rests on — the supplier of the key, and the declarer of a group it
   * belongs to. The same machine-token attribution a {@link import("../composition/types.js").ValidationIssue}
   * carries, read by the same freshness machinery for the same purpose.
   */
  packages?: readonly string[];
  /** Set when one of {@link packages} may predate its sources. */
  possiblyStale?: true;
  /** The caveat rendered with a {@link possiblyStale} answer. Set with it, never alone. */
  stalenessNote?: string;
  /** What this view could not know, stated rather than omitted. */
  notes: readonly string[];
};

/** Everything an explanation is computed from, built once from either source. */
type ExplainUniverse = {
  mode: ExplainMode;
  units: readonly ExplainUnit[];
  /** Contract slot key → contract name. */
  slotKeys: ReadonlyMap<string, string>;
  groups: ReadonlyMap<
    string,
    {
      groupKind: "collection" | "object";
      baseType: string;
      members: readonly { memberName: string; registrationKey: string }[];
      declaredBy?: string;
    }
  >;
  openers: ReadonlyMap<
    string,
    { contractName: string; variantName: string; lbvKeys: readonly string[] }
  >;
  /** Variant name → the registration keys its subtree covers. Discovery mode only. */
  subtreeKeysByVariant: ReadonlyMap<string, ReadonlySet<string>>;
  /** Group name → base type, for `group-base-marker` provenance. */
  groupBaseByName: ReadonlyMap<string, string>;
  /** `${modulePath}:${exportName}` → the marker that decided the lifetime. Discovery mode only. */
  markerByFactoryKey: ReadonlyMap<string, { name: string; lifetime: string }>;
  /** Keys a group root accounts for that the cradle does not carry. Empty without a composed view. */
  groupKeyIndex: ReadonlyMap<string, ComposedGroupKeyHit>;
  /** Keys some package declares as externals. Empty without a composed view. */
  externals: ReadonlyMap<string, ComposedExternalRow>;
  /** Packages whose manifest does not declare that it records lifetime provenance. */
  packagesWithoutProvenance: ReadonlySet<string>;
  /** `sourceId` → the name a staleness caveat calls that package. */
  staleCaveatBySourceId: ReadonlyMap<string, string>;
  /** True once a composed picture is merged in — the switch every supplier label hangs off. */
  composed: boolean;
  notes: readonly string[];
};

const isGroupRoot = (value: unknown): value is IocGroupRootManifest => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<IocGroupRootManifest>;
  return (
    (candidate.kind === "collection" || candidate.kind === "object") &&
    typeof candidate.baseType === "string" &&
    candidate.members !== undefined
  );
};

const groupMembers = (
  root: IocGroupRootManifest,
): { memberName: string; registrationKey: string }[] =>
  Array.isArray(root.members)
    ? root.members.map((leaf) => ({
        memberName: leaf.contractName,
        registrationKey: leaf.registrationKey,
      }))
    : Object.entries(
        root.members as Record<
          string,
          { contractName: string; registrationKey: string }
        >,
      ).map(([contractKey, leaf]) => ({
        memberName: contractKey,
        registrationKey: leaf.registrationKey,
      }));

/** The empty composed half — what a library-mode explanation is built over. */
const NO_COMPOSED_PICTURE = {
  groupKeyIndex: new Map<string, ComposedGroupKeyHit>(),
  externals: new Map<string, ComposedExternalRow>(),
  packagesWithoutProvenance: new Set<string>(),
  staleCaveatBySourceId: new Map<string, string>(),
  composed: false,
} as const;

/**
 * The universe as the generated manifest records it.
 *
 * `default` on a manifest row is the CLAIM, and the elected default is what the runtime registers
 * under the slot key; for explanation purposes the two only differ when election failed, which
 * `inspect` already shouts about. Here the claim is read straight, and a contract with no claim and
 * one implementation defaults to it by arithmetic — the same rule `pickDefault` applies.
 */
const universeFromManifest = (
  contracts: IocContractManifest,
  groups: IocGroupsManifest | undefined,
  scopeRoots: IocScopeRootsManifest | undefined,
  declaredFeatures: readonly string[] | undefined,
): ExplainUniverse => {
  const units: ExplainUnit[] = [];
  const slotKeys = new Map<string, string>();
  const groupedContractNames = new Set<string>();

  const groupIndex = new Map<
    string,
    {
      groupKind: "collection" | "object";
      baseType: string;
      members: readonly { memberName: string; registrationKey: string }[];
    }
  >();
  const groupBaseByName = new Map<string, string>();
  for (const [groupName, root] of Object.entries(groups ?? {})) {
    if (!isGroupRoot(root)) continue;
    const members = groupMembers(root);
    groupIndex.set(groupName, {
      groupKind: root.kind,
      baseType: root.baseType,
      members,
    });
    groupBaseByName.set(groupName, root.baseType);
    for (const leaf of Array.isArray(root.members)
      ? root.members
      : Object.values(
          root.members as Record<string, { contractName: string }>,
        )) {
      groupedContractNames.add(leaf.contractName);
    }
  }

  for (const [contractName, impls] of Object.entries(contracts)) {
    const rows = Object.values(impls);
    const claimed = rows.find((row) => row.default === true);
    const elected = claimed ?? (rows.length === 1 ? rows[0] : undefined);

    // Grouped ⇒ group-only: a grouped contract claims no slot key, so offering one here would name
    // a key the cradle does not carry.
    if (!groupedContractNames.has(contractName)) {
      slotKeys.set(
        resolveManifestAccessKey(contractName, Object.values(impls)),
        contractName,
      );
    }

    for (const row of rows) {
      units.push({
        registrationKey: row.registrationKey,
        contractName,
        implementationName: row.implementationName,
        lifetime: row.lifetime,
        ...(row.lifetimeSource !== undefined
          ? { lifetimeSource: row.lifetimeSource }
          : {}),
        modulePath: row.modulePath,
        exportName: row.exportName,
        dependencyKeys: row.dependencyKeys ?? [],
        isDefault: elected?.registrationKey === row.registrationKey,
      });
    }
  }

  const openers = new Map<
    string,
    { contractName: string; variantName: string; lbvKeys: readonly string[] }
  >();
  for (const variants of Object.values(scopeRoots ?? {})) {
    for (const meta of Object.values(variants)) {
      openers.set(meta.openerKey, {
        contractName: meta.contractName,
        variantName: meta.variantName,
        lbvKeys: meta.lbvKeys,
      });
    }
  }

  // A manifest that records provenance no longer needs to disclaim it, and one that does not must
  // still say so in the words it always used — a reader of an artifact generated before the field
  // existed is looking at exactly the document the old sentence described.
  const carriesProvenance = (declaredFeatures ?? []).includes("lifetimeSource");

  return {
    mode: "manifest",
    units,
    slotKeys,
    groups: groupIndex,
    openers,
    subtreeKeysByVariant: new Map(),
    groupBaseByName,
    markerByFactoryKey: new Map(),
    ...NO_COMPOSED_PICTURE,
    notes: [
      carriesProvenance
        ? "Read from the generated manifest. A manifest records no scope-root subtree — run `ioc explain <key> --discovery` for subtree reach."
        : "Read from the generated manifest. A manifest records the lifetime it resolved, not the marker or config that decided it, and it records no scope-root subtree — run `ioc explain <key> --discovery` for provenance and subtree reach.",
    ],
  };
};

/** The universe as a source scan sees it — everything the manifest has, plus why. */
const universeFromDiscovery = (
  analysis: DiscoveryAnalysisResult,
): ExplainUniverse => {
  const units: ExplainUnit[] = [];
  const slotKeys = new Map<string, string>();

  for (const plan of analysis.registrationPlan) {
    if (plan.contractDefaultElected !== false) {
      slotKeys.set(plan.accessKey, plan.contractName);
    }
    for (const impl of plan.implementations) {
      units.push({
        registrationKey: impl.registrationKey,
        contractName: plan.contractName,
        implementationName: impl.implementationName,
        lifetime: impl.lifetime,
        ...(impl.lifetimeSource !== undefined
          ? { lifetimeSource: impl.lifetimeSource }
          : {}),
        modulePath: impl.modulePath,
        exportName: impl.exportName,
        dependencyKeys: impl.dependencyKeys ?? [],
        isDefault:
          plan.contractDefaultElected !== false &&
          impl.implementationName === plan.defaultImplementationName,
      });
    }
  }

  const groups = new Map<
    string,
    {
      groupKind: "collection" | "object";
      baseType: string;
      members: readonly { memberName: string; registrationKey: string }[];
    }
  >();
  const groupBaseByName = new Map<string, string>();
  for (const plan of analysis.groupPlans) {
    groups.set(plan.groupName, {
      groupKind: plan.kind,
      baseType: plan.baseType,
      members:
        plan.kind === "collection"
          ? plan.members.map((m) => ({
              memberName: m.contractName,
              registrationKey: m.registrationKey,
            }))
          : plan.members.map((m) => ({
              memberName: m.contractKey,
              registrationKey: m.registrationKey,
            })),
    });
    groupBaseByName.set(plan.groupName, plan.baseType);
  }

  const openers = new Map<
    string,
    { contractName: string; variantName: string; lbvKeys: readonly string[] }
  >();
  const subtreeKeysByVariant = new Map<string, ReadonlySet<string>>();
  for (const variant of analysis.scopeRootVerification.variants) {
    openers.set(variantNameToOpenerKey(variant.variantName), {
      contractName: variant.contractName,
      variantName: variant.variantName,
      lbvKeys: variant.declaredKeys,
    });
    subtreeKeysByVariant.set(
      variant.variantName,
      // Composed units are in here already: the app-side verification walks composed subtrees, and
      // a composed unit inside one carries its registration key exactly as a local one does. So
      // "Reached from scope roots" needs nothing package-aware — it needs the composed unit to be
      // resolvable, which merging the composed view is what provides.
      new Set(
        variant.subtreeUnits
          .map((unit) => unit.registrationKey)
          .filter((key): key is string => key !== undefined),
      ),
    );
  }

  return {
    mode: "discovery",
    units,
    slotKeys,
    groups,
    openers,
    subtreeKeysByVariant,
    groupBaseByName,
    markerByFactoryKey: analysis.lifetimeMarkerMatches,
    ...NO_COMPOSED_PICTURE,
    notes: [],
  };
};

/**
 * Merges the composed picture into a local universe.
 *
 * The merge is deliberately additive and local-first. A registration key the local view already
 * knows keeps its local record — it was read from this package's own sources or manifest, which is
 * the more specific statement, and it is what discovery would resolve. What a local unit GAINS is
 * its supplier label, because in a composed picture every answer names one.
 *
 * Slot elections are the one place the composed view overrules: an election is a fact about the
 * MERGED contract set (another package may implement the same contract, and the app's config may
 * override the choice), so the local view's answer is not a competing opinion but an answer to a
 * smaller question. It is taken from the shared electee helpers, which is what makes it the same
 * answer `default-ambiguity` and `slot-occupancy` reached.
 */
const mergeComposedView = (
  local: ExplainUniverse,
  view: ExplainComposedView,
): ExplainUniverse => {
  const supplierByKey = new Map<string, ExplainSupplier>();
  for (const row of view.units) {
    if (!supplierByKey.has(row.registrationKey)) {
      supplierByKey.set(row.registrationKey, row);
    }
  }

  const localSupplier = view.units.find((row) => row.local);

  const byKey = new Map<string, ExplainUnit>();
  for (const unit of local.units) {
    const supplier = supplierByKey.get(unit.registrationKey) ?? localSupplier;
    byKey.set(unit.registrationKey, {
      ...unit,
      ...(supplier !== undefined
        ? { packageLabel: supplier.packageLabel, sourceId: supplier.sourceId }
        : {}),
    });
  }
  for (const row of view.units) {
    if (byKey.has(row.registrationKey)) {
      continue;
    }
    byKey.set(row.registrationKey, {
      registrationKey: row.registrationKey,
      contractName: row.contractName,
      implementationName: row.implementationName,
      lifetime: row.lifetime,
      ...(row.lifetimeSource !== undefined
        ? { lifetimeSource: row.lifetimeSource }
        : {}),
      modulePath: row.modulePath,
      exportName: row.exportName,
      dependencyKeys: row.dependencyKeys,
      isDefault: false,
      packageLabel: row.packageLabel,
      sourceId: row.sourceId,
    });
  }

  const units = [...byKey.values()].map((unit) => {
    const elected = view.electedKeyByContract.get(unit.contractName);
    return elected === undefined
      ? unit
      : { ...unit, isDefault: elected === unit.registrationKey };
  });

  const slotKeys = new Map(local.slotKeys);
  for (const [slotKey, contractName] of view.slotKeys) {
    slotKeys.set(slotKey, contractName);
  }

  const groups = new Map(local.groups);
  for (const [groupKey, row] of view.groups) {
    const existing = groups.get(groupKey);
    if (existing === undefined) {
      groups.set(groupKey, {
        groupKind: row.groupKind,
        baseType: row.baseType,
        members: row.members,
        declaredBy: row.packageLabel,
      });
      continue;
    }
    const members = [...existing.members];
    for (const member of row.members) {
      if (!members.some((m) => m.registrationKey === member.registrationKey)) {
        members.push(member);
      }
    }
    groups.set(groupKey, {
      ...existing,
      members,
      declaredBy: existing.declaredBy ?? row.packageLabel,
    });
  }

  const groupBaseByName = new Map(local.groupBaseByName);
  for (const [groupKey, row] of view.groups) {
    if (!groupBaseByName.has(groupKey)) {
      groupBaseByName.set(groupKey, row.baseType);
    }
  }

  return {
    ...local,
    units,
    slotKeys,
    groups,
    groupBaseByName,
    groupKeyIndex: view.groupKeyIndex,
    externals: view.externals,
    packagesWithoutProvenance: new Set(view.packagesWithoutProvenance),
    staleCaveatBySourceId: view.staleCaveatBySourceId,
    composed: true,
  };
};

/**
 * The provenance chain for one unit's lifetime.
 *
 * Each `lifetimeSource` is a token naming a MECHANISM; on its own it tells a reader which kind of
 * decision was made but not where the decision is written down. So each one is expanded with the
 * thing it points at — the marker's name, the group's base type — because the next thing the reader
 * will do is go and look at it.
 *
 * For a COMPOSED unit the marker name is not available (the marker is a type in another package's
 * sources, which this run never opened) and the expansion is the part that can be given: which
 * mechanism, and which group or config entry it points at. That is strictly more than the nothing
 * that was available before manifests carried the field.
 */
const provenanceChain = (
  unit: ExplainUnit,
  universe: ExplainUniverse,
): string[] => {
  const source = unit.lifetimeSource;
  if (source === undefined) {
    return [];
  }

  const marker = universe.markerByFactoryKey.get(
    `${unit.modulePath}:${unit.exportName}`,
  );

  if (source === "group-base-marker") {
    const group = [...universe.groups].find(([, g]) =>
      g.members.some((m) => m.registrationKey === unit.registrationKey),
    );
    const base = group?.[1].baseType;
    return [
      base !== undefined
        ? `group-base marker on ${base}${marker !== undefined ? ` (${marker.name})` : ""}`
        : "group-base marker",
      ...(group !== undefined
        ? [`member of group ${JSON.stringify(group[0])}`]
        : []),
    ];
  }

  if (source === "lifetime-marker") {
    return [
      marker !== undefined
        ? `lifetime-marker (${marker.name})`
        : "lifetime-marker",
      `on the contract site of ${unit.exportName}`,
    ];
  }

  if (source === "factory-config") {
    return [
      `ioc.config registrations[${JSON.stringify(unit.contractName)}].${unit.implementationName}.lifetime`,
    ];
  }

  if (source === "discovery-root") {
    return [`discovery.scanDirs scope covering ${unit.modulePath}`];
  }

  return ["default (nothing declared a lifetime for this unit)"];
};

/**
 * Why a unit's provenance chain is empty, when the reason is one the reader can do something about.
 *
 * Only for a supplier whose manifest does not DECLARE that it carries provenance — a package
 * generated before the field existed. Everywhere else emptiness is either impossible (discovery
 * always resolves a source) or already covered by the manifest-mode note, and a second sentence
 * saying the same thing would be noise. Never a guess: the degraded answer states the lifetime and
 * says the chain was not recorded, and stops there.
 */
const provenanceDegradedNote = (
  unit: ExplainUnit,
  universe: ExplainUniverse,
): string | undefined => {
  if (unit.lifetimeSource !== undefined || !universe.composed) {
    return undefined;
  }
  const label = unit.packageLabel;
  if (label === undefined || !universe.packagesWithoutProvenance.has(label)) {
    return undefined;
  }
  return `provenance not recorded — regenerate ${label} with a current version`;
};

/** What a demanded key turns out to be, in the vocabulary the demand model uses. */
const classifyKey = (
  key: string,
  universe: ExplainUniverse,
): {
  resolvedAs: string;
  lifetime?: string;
  unit?: ExplainUnit;
  packageLabel?: string;
} => {
  const group = universe.groups.get(key);
  if (group !== undefined) {
    return {
      resolvedAs: `group root (${group.members.length} member(s))`,
      ...(group.declaredBy !== undefined
        ? { packageLabel: group.declaredBy }
        : {}),
    };
  }
  const opener = universe.openers.get(key);
  if (opener !== undefined) {
    return { resolvedAs: `scope-root opener for ${opener.contractName}` };
  }
  const unit = universe.units.find((u) => u.registrationKey === key);
  if (unit !== undefined) {
    return {
      resolvedAs: `registration of ${unit.contractName}`,
      lifetime: unit.lifetime,
      unit,
      ...(unit.packageLabel !== undefined
        ? { packageLabel: unit.packageLabel }
        : {}),
    };
  }
  const contractName = universe.slotKeys.get(key);
  if (contractName !== undefined) {
    const electee = universe.units.find(
      (u) => u.contractName === contractName && u.isDefault,
    );
    return {
      resolvedAs: `contract slot for ${contractName}`,
      ...(electee !== undefined
        ? {
            lifetime: electee.lifetime,
            unit: electee,
            ...(electee.packageLabel !== undefined
              ? { packageLabel: electee.packageLabel }
              : {}),
          }
        : {}),
    };
  }
  const external = universe.externals.get(key);
  if (external !== undefined) {
    return {
      resolvedAs: "external (supplied by the composing app at bootstrap)",
    };
  }
  return { resolvedAs: "external (nothing in this package registers it)" };
};

const isLifetime = (value: string): value is IocLifetime =>
  value === "singleton" || value === "scoped" || value === "transient";

/**
 * Floor-rule pressure on one dependency edge, in the advisory register.
 *
 * Deliberately the same severities `validateLifetimeInversionsAtCodegen` assigns — this is a VIEW
 * of that rule, not a second opinion about it, and a screen that disagreed with the check that
 * fails the build would be worse than one that said nothing. It ranks and reports; the check is
 * still the thing that decides whether a run is allowed to proceed.
 */
const floorPressure = (
  consumerLifetime: string,
  depLifetime: string | undefined,
): ExplainDependency["pressure"] => {
  if (
    depLifetime === undefined ||
    !isLifetime(consumerLifetime) ||
    !isLifetime(depLifetime)
  ) {
    return undefined;
  }
  const severity = inversionSeverity(consumerLifetime, depLifetime);
  if (severity === undefined) {
    return undefined;
  }
  return {
    severity,
    message:
      severity === "error"
        ? `a ${consumerLifetime} freezes its ${depLifetime} dependency at first construction and reuses it across every scope`
        : `a ${consumerLifetime} consumer holding a ${depLifetime} dependency keeps the first instance it was given`,
  };
};

/**
 * Every unit that demands `key`, directly, through a group root, or through a contract slot.
 *
 * Cross-package for free: the hops are the same three, and once the composed units are in the
 * universe a library unit demanded by an app unit and by another library unit turns up as two rows,
 * each attributed to the package the demander lives in.
 */
const findDependents = (
  key: string,
  universe: ExplainUniverse,
): ExplainDependent[] => {
  const reachedBy = new Map<string, string>([[key, "direct"]]);

  for (const [groupName, group] of universe.groups) {
    if (group.members.some((m) => m.registrationKey === key)) {
      reachedBy.set(groupName, `group:${groupName}`);
    }
  }

  const unit = universe.units.find((u) => u.registrationKey === key);
  if (unit?.isDefault === true) {
    for (const [slotKey, contractName] of universe.slotKeys) {
      if (contractName === unit.contractName) {
        reachedBy.set(slotKey, `slot:${slotKey}`);
      }
    }
  }

  const dependents: ExplainDependent[] = [];
  for (const candidate of universe.units) {
    for (const [demandedKey, via] of reachedBy) {
      if (candidate.dependencyKeys.includes(demandedKey)) {
        dependents.push({
          demander: candidate.registrationKey,
          modulePath: candidate.modulePath,
          via,
          ...(candidate.packageLabel !== undefined
            ? { packageLabel: candidate.packageLabel }
            : {}),
        });
        break;
      }
    }
  }

  return dependents.sort((a, b) => a.demander.localeCompare(b.demander));
};

const similarKeys = (key: string, universe: ExplainUniverse): string[] => {
  const needle = key.toLowerCase();
  const all = [
    ...universe.units.map((u) => u.registrationKey),
    ...universe.slotKeys.keys(),
    ...universe.groups.keys(),
    ...universe.openers.keys(),
  ];
  return [
    ...new Set(
      all.filter(
        (candidate) =>
          candidate.toLowerCase().includes(needle) ||
          needle.includes(candidate.toLowerCase()),
      ),
    ),
  ]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 8);
};

/**
 * Resolution order is the demand model's own: group root, opener, registration key, contract slot,
 * then externals. It matches `classifyDemandedKey` in the scope-root walk, so what `explain` says a
 * key is cannot differ from what generation resolves it to.
 *
 * The two answers past the container's own precedence — the grouped member's would-be key and the
 * declared external — are reached only after all of it has missed, which is exactly where they
 * belong: both describe a key the cradle does not carry, and both are still real answers.
 */
const resolveKey = (
  key: string,
  universe: ExplainUniverse,
): ExplainResolution => {
  const group = universe.groups.get(key);
  if (group !== undefined) {
    return {
      kind: "group",
      groupName: key,
      groupKind: group.groupKind,
      baseType: group.baseType,
      members: group.members.map((member) => {
        const supplier = universe.units.find(
          (u) => u.registrationKey === member.registrationKey,
        );
        return {
          ...member,
          ...(supplier?.packageLabel !== undefined
            ? { packageLabel: supplier.packageLabel }
            : {}),
        };
      }),
      ...(group.declaredBy !== undefined
        ? { declaredBy: group.declaredBy }
        : {}),
    };
  }

  const opener = universe.openers.get(key);
  if (opener !== undefined) {
    return {
      kind: "opener",
      openerKey: key,
      contractName: opener.contractName,
      variantName: opener.variantName,
      lbvKeys: opener.lbvKeys,
    };
  }

  const unit = universe.units.find((u) => u.registrationKey === key);
  if (unit !== undefined) {
    return { kind: "registration", unit };
  }

  const contractName = universe.slotKeys.get(key);
  if (contractName !== undefined) {
    const implementations = universe.units.filter(
      (u) => u.contractName === contractName,
    );
    const electee = implementations.find((u) => u.isDefault);
    return {
      kind: "contract-slot",
      accessKey: key,
      contractName,
      ...(electee !== undefined ? { electee } : {}),
      implementations: implementations.map((u) => u.registrationKey).sort(),
    };
  }

  const groupHit = universe.groupKeyIndex.get(key);
  if (groupHit !== undefined) {
    return {
      kind: "grouped-member",
      groupKey: groupHit.groupKey,
      groupKind: groupHit.kind,
      baseType: groupHit.baseType,
      declaredBy: groupHit.declaredBy,
      declaredByComposedPackage: groupHit.declaredByComposedPackage,
      ...(groupHit.contractName !== undefined
        ? { contractName: groupHit.contractName }
        : {}),
      ...(groupHit.memberProperty !== undefined
        ? { recordPropertyKey: groupHit.memberProperty }
        : {}),
    };
  }

  const external = universe.externals.get(key);
  if (external !== undefined) {
    return {
      kind: "external",
      typeText: external.typeText,
      demandedBy: external.demandedBy.map((s) => ({
        packageLabel: s.packageLabel,
        sourceId: s.sourceId,
      })),
    };
  }

  return { kind: "unknown", similarKeys: similarKeys(key, universe) };
};

/**
 * The `sourceId`s an answer rests on, in the order they were reached, deduplicated.
 *
 * The same attribution a `ValidationIssue` carries and for the same reason: this is what the
 * freshness machinery matches on to decide whether the answer may describe the old world. A group
 * answer rests on every package supplying a member, because the membership list is read out of
 * their manifests; a grouped-member answer rests on the package that DECLARES the root, because
 * "this contract is grouped" is a claim read straight out of it.
 */
const packagesForResolution = (
  key: string,
  resolution: ExplainResolution,
  subject: ExplainUnit | undefined,
  universe: ExplainUniverse,
): readonly string[] => {
  const ids: string[] = [];
  if (subject?.sourceId !== undefined) {
    ids.push(subject.sourceId);
  }
  if (resolution.kind === "grouped-member") {
    const hit = universe.groupKeyIndex.get(key);
    if (hit !== undefined) {
      ids.push(hit.declaredBySourceId);
    }
  }
  if (resolution.kind === "group") {
    for (const member of resolution.members) {
      const supplier = universe.units.find(
        (u) => u.registrationKey === member.registrationKey,
      );
      if (supplier?.sourceId !== undefined) {
        ids.push(supplier.sourceId);
      }
    }
  }
  if (resolution.kind === "external") {
    ids.push(...resolution.demandedBy.map((s) => s.sourceId));
  }
  return [...new Set(ids)];
};

const buildExplainReport = (
  key: string,
  universe: ExplainUniverse,
): ExplainReport => {
  const resolution = resolveKey(key, universe);

  // The unit whose lifetime and dependencies the report is about: the registration itself, or the
  // implementation a contract slot elects. A group root and an opener have neither.
  const subject =
    resolution.kind === "registration"
      ? resolution.unit
      : resolution.kind === "contract-slot"
        ? resolution.electee
        : undefined;

  const dependencies: ExplainDependency[] =
    subject === undefined
      ? []
      : subject.dependencyKeys.map((depKey) => {
          const classified = classifyKey(depKey, universe);
          const pressure = floorPressure(subject.lifetime, classified.lifetime);
          return {
            key: depKey,
            resolvedAs: classified.resolvedAs,
            ...(classified.lifetime !== undefined
              ? { lifetime: classified.lifetime }
              : {}),
            ...(classified.packageLabel !== undefined
              ? { packageLabel: classified.packageLabel }
              : {}),
            ...(pressure !== undefined ? { pressure } : {}),
          };
        });

  const subtreeKey =
    resolution.kind === "registration"
      ? resolution.unit.registrationKey
      : resolution.kind === "contract-slot"
        ? resolution.electee?.registrationKey
        : undefined;

  const scopeRootSubtrees =
    subtreeKey === undefined
      ? []
      : [...universe.subtreeKeysByVariant]
          .filter(([, keys]) => keys.has(subtreeKey))
          .map(([variantName]) => ({
            contractName:
              universe.openers.get(variantNameToOpenerKey(variantName))
                ?.contractName ?? variantName,
            variantName,
            openerKey: variantNameToOpenerKey(variantName),
          }))
          .sort((a, b) => a.variantName.localeCompare(b.variantName));

  const packages = packagesForResolution(key, resolution, subject, universe);
  const staleNames = packages
    .map((sourceId) => universe.staleCaveatBySourceId.get(sourceId))
    .filter((name): name is string => name !== undefined);

  const degradedNote =
    subject === undefined
      ? undefined
      : provenanceDegradedNote(subject, universe);

  return {
    key,
    mode: universe.mode,
    resolution,
    ...(subject !== undefined
      ? {
          lifetime: {
            lifetime: subject.lifetime,
            provenance: provenanceChain(subject, universe),
            ...(degradedNote !== undefined ? { degradedNote } : {}),
          },
        }
      : {}),
    ...(subject?.packageLabel !== undefined && subject.sourceId !== undefined
      ? {
          supplier: {
            packageLabel: subject.packageLabel,
            sourceId: subject.sourceId,
          },
        }
      : {}),
    ...(universe.composed ? { composed: true as const } : {}),
    dependencies,
    dependents: findDependents(key, universe),
    scopeRootSubtrees,
    ...(packages.length > 0 ? { packages } : {}),
    ...(staleNames.length > 0
      ? {
          possiblyStale: true as const,
          stalenessNote: formatFreshnessCaveat([...new Set(staleNames)]),
        }
      : {}),
    notes: universe.notes,
  };
};

/** Explain one key against the generated manifest, and the composed picture when there is one. */
export const explainFromManifest = (
  key: string,
  manifest: {
    contracts: IocContractManifest;
    groups: IocGroupsManifest;
    scopeRoots: IocScopeRootsManifest | undefined;
    /** The local manifest's `IOC_MANIFEST_FEATURES`, which decides how absence is worded. */
    declaredFeatures?: readonly string[] | undefined;
  },
  composed?: ExplainComposedView,
): ExplainReport => {
  const local = universeFromManifest(
    manifest.contracts,
    manifest.groups,
    manifest.scopeRoots,
    manifest.declaredFeatures,
  );
  return buildExplainReport(
    key,
    composed === undefined ? local : mergeComposedView(local, composed),
  );
};

/** Explain one key against a fresh source scan, and the composed picture when there is one. */
export const explainFromDiscovery = (
  key: string,
  analysis: DiscoveryAnalysisResult,
  composed?: ExplainComposedView,
): ExplainReport => {
  const local = universeFromDiscovery(analysis);
  return buildExplainReport(
    key,
    composed === undefined ? local : mergeComposedView(local, composed),
  );
};
