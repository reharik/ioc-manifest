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
 * ### Read-only, and parse-only
 *
 * Nothing here writes, and nothing here imports the generated manifest — the same discipline
 * `loadManifestForInspection` keeps, for the same reason (the CLI runs under plain `node`).
 *
 * ### Two modes, two depths, stated honestly
 *
 * Manifest mode reads the file on disk; discovery mode re-runs the scan. The manifest does not
 * record WHY a lifetime is what it is, and it records no scope-root subtree, so manifest mode says
 * so rather than guessing — the same stance every other manifest-sourced view in this package takes
 * about the things a manifest cannot know.
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
};

/** One step of the provenance chain: `scoped ← group-base marker on WriteServiceBase`. */
export type ExplainLifetime = {
  lifetime: string;
  /** Chain steps, nearest cause first. Empty when the view cannot know (manifest mode). */
  provenance: readonly string[];
};

export type ExplainDependency = {
  key: string;
  /** What the key turned out to be: a registration, a contract slot, a group, an opener, external. */
  resolvedAs: string;
  lifetime?: string;
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
      members: readonly { memberName: string; registrationKey: string }[];
    }
  | {
      kind: "opener";
      openerKey: string;
      contractName: string;
      variantName: string;
      lbvKeys: readonly string[];
    }
  | { kind: "unknown"; similarKeys: readonly string[] };

export type ExplainReport = {
  key: string;
  mode: ExplainMode;
  resolution: ExplainResolution;
  /** Absent for a key with no single unit behind it (a group root, an unknown key). */
  lifetime?: ExplainLifetime;
  dependencies: readonly ExplainDependency[];
  dependents: readonly ExplainDependent[];
  /** Scope-root variants whose resolution subtree reaches this key. Discovery mode only. */
  scopeRootSubtrees: readonly {
    contractName: string;
    variantName: string;
    openerKey: string;
  }[];
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

  return {
    mode: "manifest",
    units,
    slotKeys,
    groups: groupIndex,
    openers,
    subtreeKeysByVariant: new Map(),
    groupBaseByName,
    markerByFactoryKey: new Map(),
    notes: [
      "Read from the generated manifest. A manifest records the lifetime it resolved, not the marker or config that decided it, and it records no scope-root subtree — run `ioc explain <key> --discovery` for provenance and subtree reach.",
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
    notes: [],
  };
};

/**
 * The provenance chain for one unit's lifetime.
 *
 * Each `lifetimeSource` is a token naming a MECHANISM; on its own it tells a reader which kind of
 * decision was made but not where the decision is written down. So each one is expanded with the
 * thing it points at — the marker's name, the group's base type — because the next thing the reader
 * will do is go and look at it.
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

/** What a demanded key turns out to be, in the vocabulary the demand model uses. */
const classifyKey = (
  key: string,
  universe: ExplainUniverse,
): { resolvedAs: string; lifetime?: string; unit?: ExplainUnit } => {
  const group = universe.groups.get(key);
  if (group !== undefined) {
    return { resolvedAs: `group root (${group.members.length} member(s))` };
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
    };
  }
  const contractName = universe.slotKeys.get(key);
  if (contractName !== undefined) {
    const electee = universe.units.find(
      (u) => u.contractName === contractName && u.isDefault,
    );
    return {
      resolvedAs: `contract slot for ${contractName}`,
      ...(electee !== undefined ? { lifetime: electee.lifetime, unit: electee } : {}),
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

/** Every unit that demands `key`, directly, through a group root, or through a contract slot. */
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
 * then nothing. It matches `classifyDemandedKey` in the scope-root walk, so what `explain` says a
 * key is cannot differ from what generation resolves it to.
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
      members: group.members,
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

  return { kind: "unknown", similarKeys: similarKeys(key, universe) };
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

  return {
    key,
    mode: universe.mode,
    resolution,
    ...(subject !== undefined
      ? {
          lifetime: {
            lifetime: subject.lifetime,
            provenance: provenanceChain(subject, universe),
          },
        }
      : {}),
    dependencies,
    dependents: findDependents(key, universe),
    scopeRootSubtrees,
    notes: universe.notes,
  };
};

/** Explain one key against the generated manifest. */
export const explainFromManifest = (
  key: string,
  manifest: {
    contracts: IocContractManifest;
    groups: IocGroupsManifest;
    scopeRoots: IocScopeRootsManifest | undefined;
  },
): ExplainReport =>
  buildExplainReport(
    key,
    universeFromManifest(manifest.contracts, manifest.groups, manifest.scopeRoots),
  );

/** Explain one key against a fresh source scan. */
export const explainFromDiscovery = (
  key: string,
  analysis: DiscoveryAnalysisResult,
): ExplainReport => buildExplainReport(key, universeFromDiscovery(analysis));
