/**
 * @fileoverview Builds structured reports for inspection: manifest contracts → human-oriented rows,
 * plus discovery-oriented summaries from analyzer inputs.
 *
 * Two commands, two questions. `inspect` reports **state** — what the manifest is: contracts, keys,
 * defaults, groups. `inspect --discovery` reports **process** — what the scan did: per-export
 * outcomes, near-misses, scope-root verification. Both build the full record here; hiding rows and
 * filtering is a presentation concern applied on top (see {@link filterDiscoveryReportByContract}).
 */
import { selectDefaultImplementationName } from "../core/defaultImplementationSelection.js";
import type {
  IocContractManifest,
  IocGroupsManifest,
  IocGroupRootManifest,
  IocScopeRootsManifest,
  ModuleFactoryManifestMetadata,
} from "../core/manifest.js";
import {
  IocDiscoverySkipReason,
  IocDiscoveryStatus,
  type IocDiscoveryAnalysisFiles,
  type IocDiscoveryOutcome,
} from "../generator/discoverFactories/discoveryOutcomeTypes.js";
import { variantNameToOpenerKey } from "../generator/naming.js";
import type { ResolvedContractRegistration } from "../generator/resolveRegistrationPlan.js";
import type { ScopeRootSharedSubtreeUnit } from "../generator/scopeRootExternalsExclusion.js";
import type { DiscoveredScopeRoot } from "../generator/types.js";
import type {
  ScopeRootVariantVerification,
  ScopeRootVerificationResult,
} from "../generator/verifyScopeRoots.js";
import {
  glossForGroupRejection,
  type GroupMembershipRejectionReason,
} from "../groups/baseTypeAssignability.js";
import type { GroupPlan } from "../groups/resolveGroupPlan.js";
import {
  glossForSkipReason,
  isConditionalNearMissReason,
  partitionForSkipReason,
  type DiscoveryRowPartition,
} from "./skipReasonPartition.js";
import type { ManifestValidationIssue } from "./validateManifest.js";
import { validateManifest } from "./validateManifest.js";

export type DiscoveryReportInput =
  | IocDiscoveryAnalysisFiles
  | {
      discoveryFiles: IocDiscoveryAnalysisFiles;
      /** Omitted by callers that only have per-file outcomes; the scope-root section is then empty. */
      scopeRoots?: readonly DiscoveredScopeRoot[];
      /** Stage-2 verification, matched to variants by (modulePath, exportName). Omitted ⇒ unverified. */
      scopeRootVerification?: ScopeRootVerificationResult;
      /**
       * Units demanding a declared late-bound value from inside a declaring subtree while also
       * being reachable from outside it. Recorded, not diagnosed — see the note on the type.
       */
      scopeRootSharedUnits?: readonly ScopeRootSharedSubtreeUnit[];
      /**
       * Resolved lifetimes, joined onto discovered rows by (modulePath, exportName). This is what
       * lets a discovered row carry `scoped (lifetime-marker)` instead of a separate lifetime
       * section repeating every unit a second time.
       */
      registrationPlan?: readonly ResolvedContractRegistration[];
      /** Group plans from the non-throwing analyzer; carries membership and rejections. */
      groupPlans?: readonly GroupPlan[];
      /**
       * Module paths the config's `discovery.excludes` kept out of the scan, resolved by
       * `runDiscoveryAnalysis`. Rendered as synthetic rows — see {@link buildExcludedFileEntries}.
       */
      excludedFiles?: readonly string[];
    };

/** One rejected group candidate, flattened for reporting. */
export type GroupRejectionReportRow = {
  contractName: string;
  /** Present for implementation-level rejections; absent when the whole contract was dropped. */
  registrationKey?: string;
  /** Verbatim reason code — the grep handle. */
  reason: GroupMembershipRejectionReason;
  gloss: string;
};

/**
 * One configured group. Built either from the generated manifest (`inspect`, no rejections — the
 * manifest never carries them) or from a group plan (`inspect --discovery`, rejections included).
 */
export type InspectionGroupReport = {
  groupName: string;
  kind: "collection" | "object";
  baseType: string;
  baseTypeArg?: string;
  /** `memberName` is the contract name for collection groups, the contract key for object groups. */
  members: readonly { memberName: string; registrationKey: string }[];
  rejections: readonly GroupRejectionReportRow[];
  /** True when this view could not know about rejections (manifest-sourced groups). */
  rejectionsUnavailable?: true;
};

export type InspectionContractReport = {
  contractName: string;
  defaultImplementationName: string | undefined;
  defaultRegistrationKey: string | undefined;
  implementations: readonly {
    implementationName: string;
    registrationKey: string;
    lifecycle: string;
    modulePath: string;
    exportName: string;
    /** True for the implementation that ACTUALLY backs the contract's default slot. */
    isDefault: boolean;
    /**
     * True when this implementation CLAIMS the default (`default: true` in the manifest).
     *
     * Distinct from {@link isDefault}, and only distinguishable from it when election went wrong:
     * two claimants elect nobody, so both carry `claimsDefault` and neither carries `isDefault`.
     * That is exactly the case the human report has to shout about, and it is unreadable from
     * `isDefault` alone — which is why the record carries the claim too.
     */
    claimsDefault: boolean;
  }[];
};

/**
 * One emitted scope-root opener, as the generated manifest carries it.
 *
 * Deliberately a separate section rather than a contract row: a scope-rooted contract claims no
 * cradle key and elects no default, so it has nothing to say in the contracts list. The opener key
 * is the only key it puts in the cradle, and this is where a reader finds it.
 */
export type InspectionOpenerReport = {
  openerKey: string;
  contractName: string;
  variantName: string;
  /** Declared late-bound values the opener requires at every call, sorted. */
  lbvKeys: readonly string[];
};

export type InspectionReport = {
  contracts: readonly InspectionContractReport[];
  manifestIssues: readonly ManifestValidationIssue[];
  groups: readonly InspectionGroupReport[];
  /** Emitted openers, one per scope-root variant; empty when the manifest declares none. */
  openers: readonly InspectionOpenerReport[];
  /** Present when a `--contract` filter was applied; rows are a subset, counts are not. */
  filter?: { contract: string };
  /** Contract count over the unfiltered set, so a filtered view still says how much it hid. */
  totalContractCount: number;
};

const pickDefault = (
  contractName: string,
  impls: Record<string, ModuleFactoryManifestMetadata>,
): { name: string; meta: ModuleFactoryManifestMetadata } | undefined => {
  const list = Object.values(impls);
  if (list.length === 0) return undefined;

  try {
    const name = selectDefaultImplementationName(
      contractName,
      list.map((m) => ({
        implementationName: m.implementationName,
        registrationKey: m.registrationKey,
        ...(m.default === true ? { default: true as const } : {}),
      })),
    );

    const meta = list.find((m) => m.implementationName === name);
    return meta ? { name, meta } : undefined;
  } catch {
    return undefined;
  }
};

const isGroupRootManifest = (value: unknown): value is IocGroupRootManifest => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<IocGroupRootManifest>;
  return (
    (candidate.kind === "collection" || candidate.kind === "object") &&
    typeof candidate.baseType === "string" &&
    candidate.members !== undefined
  );
};

/**
 * Group roots as the generated manifest carries them. Members are real; rejections are not knowable
 * from a manifest — the membership pass that recorded them ran at generation.
 */
export const buildGroupReportsFromManifest = (
  groups: IocGroupsManifest | undefined,
): InspectionGroupReport[] => {
  if (groups === undefined) return [];

  return Object.keys(groups)
    .sort((a, b) => a.localeCompare(b))
    .flatMap((groupName) => {
      const root = groups[groupName];
      if (!isGroupRootManifest(root)) return [];

      const members = Array.isArray(root.members)
        ? root.members.map((leaf) => ({
            memberName: leaf.contractName,
            registrationKey: leaf.registrationKey,
          }))
        : Object.keys(root.members)
            .sort((a, b) => a.localeCompare(b))
            .map((contractKey) => ({
              memberName: contractKey,
              registrationKey: (
                root.members as Record<
                  string,
                  { contractName: string; registrationKey: string }
                >
              )[contractKey]!.registrationKey,
            }));

      return [
        {
          groupName,
          kind: root.kind,
          baseType: root.baseType,
          ...(root.baseTypeArg !== undefined
            ? { baseTypeArg: root.baseTypeArg }
            : {}),
          members,
          rejections: [],
          rejectionsUnavailable: true as const,
        },
      ];
    });
};

/** Group plans from the generator-side membership pass — members and the candidates it dropped. */
export const buildGroupReportsFromPlans = (
  plans: readonly GroupPlan[],
): InspectionGroupReport[] =>
  [...plans]
    .sort((a, b) => a.groupName.localeCompare(b.groupName))
    .map((plan) => ({
      groupName: plan.groupName,
      kind: plan.kind,
      baseType: plan.baseType,
      ...(plan.baseTypeArg !== undefined
        ? { baseTypeArg: plan.baseTypeArg }
        : {}),
      members:
        plan.kind === "collection"
          ? plan.members.map((member) => ({
              memberName: member.contractName,
              registrationKey: member.registrationKey,
            }))
          : plan.members.map((member) => ({
              memberName: member.contractKey,
              registrationKey: member.registrationKey,
            })),
      rejections: [...plan.rejections]
        .sort(
          (a, b) =>
            a.contractName.localeCompare(b.contractName) ||
            (a.registrationKey ?? "").localeCompare(b.registrationKey ?? ""),
        )
        .map((rejection) => ({
          contractName: rejection.contractName,
          ...(rejection.registrationKey !== undefined
            ? { registrationKey: rejection.registrationKey }
            : {}),
          reason: rejection.reason,
          gloss: glossForGroupRejection(rejection.reason),
        })),
    }));

export type BuildInspectionReportOptions = {
  /** Group roots read off the generated manifest (top-level non-fixed keys). */
  groups?: IocGroupsManifest;
  /** Scope roots read off the generated manifest's `scopeRoots` field. */
  scopeRoots?: IocScopeRootsManifest;
};

/** Flattens the manifest's scope-root rows into opener rows, sorted by opener key. */
export const buildOpenerReportsFromManifest = (
  scopeRoots: IocScopeRootsManifest | undefined,
): InspectionOpenerReport[] =>
  Object.values(scopeRoots ?? {})
    .flatMap((variants) => Object.values(variants))
    .map((meta) => ({
      openerKey: meta.openerKey,
      contractName: meta.contractName,
      variantName: meta.variantName,
      lbvKeys: meta.lbvKeys,
    }))
    .sort((a, b) => a.openerKey.localeCompare(b.openerKey));

export const buildInspectionReport = (
  contracts: IocContractManifest,
  options?: BuildInspectionReportOptions,
): InspectionReport => {
  const manifestIssues = validateManifest(contracts);

  const contractNames = Object.keys(contracts).sort((a, b) =>
    a.localeCompare(b),
  );

  const contractsOut: InspectionContractReport[] = contractNames.map(
    (contractName) => {
      const impls = contracts[contractName]!;
      const implKeys = Object.keys(impls).sort((a, b) => a.localeCompare(b));

      const selected = pickDefault(contractName, impls);

      return {
        contractName,
        defaultImplementationName: selected?.name,
        defaultRegistrationKey: selected?.meta.registrationKey,
        implementations: implKeys.map((k) => {
          const m = impls[k]!;
          return {
            implementationName: m.implementationName,
            registrationKey: m.registrationKey,
            lifecycle: m.lifetime,
            modulePath: m.modulePath,
            exportName: m.exportName,
            isDefault: selected?.name === m.implementationName,
            claimsDefault: m.default === true,
          };
        }),
      };
    },
  );

  return {
    contracts: contractsOut,
    manifestIssues,
    groups: buildGroupReportsFromManifest(options?.groups),
    openers: buildOpenerReportsFromManifest(options?.scopeRoots),
    totalContractCount: contractsOut.length,
  };
};

export type DiscoveryExportReportRow = {
  modulePath: string;
  exportName?: string;
  status: "discovered" | "skipped";
  contractName?: string;
  skipReason?: string;
  /**
   * Which half of the default screen this row belongs to. Set on skipped rows only — a discovered
   * row is never hidden. See `skipReasonPartition.ts` for the classification.
   */
  partition?: DiscoveryRowPartition;
  /** One-sentence human gloss for {@link skipReason}, when the reason carries one. */
  gloss?: string;
  registrationKey?: string;
  /** Resolved lifetime, joined from the registration plan (discovered non-scope-root rows). */
  lifetime?: string;
  /** Where {@link lifetime} came from, verbatim (`lifetime-marker`, `discovery-root`, …). */
  lifetimeSource?: string;
  /** Set for `class_inherited_contract_not_declared`: the base whose contract was not restated. */
  baseClassName?: string;
  /**
   * Set on the discovered implementation that backs its contract's default slot.
   *
   * Joined from the registration plan, the same way {@link lifetime} is. Absent on every other row,
   * including every row of a single-implementation contract: a contract with one implementation
   * defaults trivially, and saying so on all of them is what buries the contract where the default
   * was actually contested.
   */
  isDefault?: true;
  /** Set when this export is a scope-root unit rather than an ordinary registration. */
  isScopeRoot?: true;
  /**
   * Scope roots only: the cradle key of the opener emitted for this variant. The variant itself
   * claims no key — this is the one key the scope root puts in the cradle.
   */
  openerKey?: string;
  /** Scope roots only: the declared lbv type argument as written (captured, never resolved). */
  declaredLbv?: string;
  /** Scope roots only: property names read off the declared lbv, when verification supplied them. */
  declaredLbvKeys?: readonly string[];
  /** Scope roots only: the stage-2 verdict for this variant, when verification ran. */
  scopeRootVerification?: DiscoveryScopeRootVerificationRow;
};

/** Stage-2 verification of one variant, flattened for reporting. */
export type DiscoveryScopeRootVerificationRow = {
  satisfied: boolean;
  /** Keys the subtree demands that no manifest registration supplies. */
  scopeDemands: readonly {
    key: string;
    satisfiedBy: "declared-lbv" | "undeclared" | "type-mismatch";
    via: string;
    demandedTypeText?: string;
    suppliedTypeText?: string;
  }[];
  /**
   * Container-supplied keys this layer could not expand but generation resolves. Rendered as
   * resolved, never as unsatisfied — see the call-site note in `runDiscoveryAnalysis`.
   */
  generationResolvedKeys: readonly { key: string; via: "group"; path: string }[];
  /** Declared lbv keys nothing under the root demands. */
  unusedDeclaredKeys: readonly string[];
  /**
   * Composed packages this subtree reaches whose manifests carry no dependency data.
   *
   * Non-empty means the verdict on this row covers only the part of the subtree that could be
   * walked. Rendered next to the verdict rather than tucked into the findings list, because it
   * qualifies the verdict itself.
   */
  blindComposedPackages: readonly string[];
  findings: readonly {
    severity: "error" | "warn";
    code: string;
    key: string;
    message: string;
  }[];
};

/** One scope-root variant — the factory identity is what distinguishes variants of a root. */
export type DiscoveryScopeRootVariantRow = {
  variantName: string;
  exportName: string;
  modulePath: string;
  /** Cradle key of this variant's emitted opener (`authRouter` → `openAuthRouterScope`). */
  openerKey: string;
  /** The declared lbv type argument as written. The record keeps the raw node; this is its text. */
  declaredLbv: string;
  /** Property names read off the declared lbv, when verification supplied them. */
  declaredKeys?: readonly string[];
  /**
   * Present only when the caller supplied stage-2 results. Verification is per variant and never
   * merged across the variants of a root contract.
   */
  verification?: DiscoveryScopeRootVerificationRow;
};

/**
 * One scope root, with every factory declaring it as a variant. Reported, not manifest-emitted:
 * stage 1 keeps scope roots out of the registration plan entirely.
 */
export type DiscoveryScopeRootRow = {
  contractName: string;
  lifetime: string;
  variants: readonly DiscoveryScopeRootVariantRow[];
};

/** Footer counts. Always computed over the FULL scan, never over a filtered or hidden subset. */
export type DiscoverySummary = {
  /** Files that entered the scan. Excluded files are not among them and are counted separately. */
  filesScanned: number;
  unitsDiscovered: number;
  nearMisses: number;
  /** Scanned files whose every row is not-a-candidate — the ones the default screen omits. */
  notACandidateFiles: number;
  /**
   * Files the config's `discovery.excludes` removed before the scan. Counted in **files**, not
   * exports: naming an excluded file's exports would mean parsing exactly the files the config
   * asked us not to parse. Called out on its own in the footer so a stale exclude has a heartbeat.
   */
  filesExcludedByConfig: number;
};

export type DiscoveryReport = {
  files: readonly {
    modulePath: string;
    rows: readonly DiscoveryExportReportRow[];
  }[];
  /** Grouped by root contract; empty when the input carried no scope-root rows. */
  scopeRoots: readonly DiscoveryScopeRootRow[];
  /**
   * Units reachable both from inside a declaring scope-root subtree and from outside it, which is
   * why the late-bound value they demand stays in `IocExternals`. Almost always empty; carried so a
   * migration can find real instances rather than inferring them from an unexpected externals entry.
   */
  scopeRootSharedUnits: readonly ScopeRootSharedSubtreeUnit[];
  /** Configured groups with membership and rejections; empty when no group plan was supplied. */
  groups: readonly InspectionGroupReport[];
  /**
   * Module paths `discovery.excludes` kept out of the scan, sorted. Carried unconditionally (the
   * complete-record rule) even though the default human screen hides the matching rows.
   */
  excludedByConfig: readonly string[];
  summary: DiscoverySummary;
  /** Present when a `--contract` filter was applied; rows are a subset, {@link summary} is not. */
  filter?: { contract: string };
};

/**
 * Contracts a concrete class in this scan actually registered. Mirrors the condition
 * `warnUnusableFactoryExports` uses: an abstract base declaring a contract that something concrete
 * registers is doing its job and stays a not-a-candidate row.
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

const classifySkip = (
  reason: IocDiscoverySkipReason,
  contractName: string | undefined,
  registeredByConcreteClasses: ReadonlySet<string>,
): DiscoveryRowPartition => {
  const base = partitionForSkipReason(reason);
  if (base === "near_miss" || !isConditionalNearMissReason(reason)) {
    return base;
  }
  // The conditional promotion: an abstract base whose contract nothing concrete registers is the
  // case that warns at generation, so it earns a line on the default screen too.
  return contractName === undefined ||
    !registeredByConcreteClasses.has(contractName)
    ? "near_miss"
    : "not_a_candidate";
};

type PlanJoin = ReadonlyMap<
  string,
  { lifetime: string; lifetimeSource?: string; isDefault?: true }
>;

const factoryJoinKey = (modulePath: string, exportName: string): string =>
  `${modulePath} ${exportName}`;

/**
 * Per-unit facts the registration plan settles: resolved lifetime, and whether this unit won its
 * contract's default slot.
 *
 * `isDefault` is set only where a contract has more than one implementation. A sole implementation
 * defaults by arithmetic rather than by decision, and marking it would put the same badge on every
 * healthy row in the report — leaving the one contested contract indistinguishable from the rest.
 * `contractDefaultElected: false` (a group base that elected nobody) marks nobody either: the plan
 * still names a deterministic pick there, but no singular default key is emitted for it, so
 * claiming one would report a key the container will not have.
 */
const buildPlanJoin = (
  plan: readonly ResolvedContractRegistration[] | undefined,
): PlanJoin => {
  const map = new Map<
    string,
    { lifetime: string; lifetimeSource?: string; isDefault?: true }
  >();
  for (const contract of plan ?? []) {
    const marksDefault =
      contract.implementations.length > 1 &&
      contract.contractDefaultElected !== false;
    for (const impl of contract.implementations) {
      map.set(factoryJoinKey(impl.modulePath, impl.exportName), {
        lifetime: impl.lifetime,
        ...(impl.lifetimeSource !== undefined
          ? { lifetimeSource: impl.lifetimeSource }
          : {}),
        ...(marksDefault &&
        impl.implementationName === contract.defaultImplementationName
          ? { isDefault: true as const }
          : {}),
      });
    }
  }
  return map;
};

type RowBuildContext = {
  registeredByConcreteClasses: ReadonlySet<string>;
  plan: PlanJoin;
  verificationByVariant: ReadonlyMap<string, ScopeRootVariantVerification>;
};

const outcomeToRows = (
  modulePath: string,
  outcome: IocDiscoveryOutcome,
  ctx: RowBuildContext,
): DiscoveryExportReportRow[] => {
  if (outcome.scope === "file") {
    const fileGloss = glossForSkipReason(outcome.skipReason);
    return [
      {
        modulePath,
        status: "skipped",
        skipReason: outcome.skipReason,
        partition: classifySkip(
          outcome.skipReason,
          undefined,
          ctx.registeredByConcreteClasses,
        ),
        ...(fileGloss !== undefined ? { gloss: fileGloss } : {}),
      },
    ];
  }

  if (outcome.status === "discovered") {
    const planned = ctx.plan.get(factoryJoinKey(modulePath, outcome.exportName));
    const verification =
      outcome.isScopeRoot === true
        ? ctx.verificationByVariant.get(
            factoryJoinKey(modulePath, outcome.exportName),
          )
        : undefined;

    return [
      {
        modulePath,
        exportName: outcome.exportName,
        status: "discovered",
        contractName: outcome.contractName,
        registrationKey: outcome.registrationKey,
        ...(planned !== undefined ? planned : {}),
        ...(outcome.isScopeRoot === true
          ? {
              isScopeRoot: true as const,
              // Derived, not joined: the opener key is a pure function of the variant identity, so
              // the row can carry it without the report needing an emission plan in hand.
              openerKey: variantNameToOpenerKey(outcome.implementationName),
            }
          : {}),
        ...(outcome.declaredLbv !== undefined
          ? { declaredLbv: outcome.declaredLbv }
          : {}),
        ...(verification !== undefined
          ? {
              declaredLbvKeys: verification.declaredKeys,
              scopeRootVerification: toVerificationRow(verification),
            }
          : {}),
      },
    ];
  }

  const gloss = glossForSkipReason(outcome.skipReason);
  return [
    {
      modulePath,
      exportName: outcome.exportName,
      status: "skipped",
      skipReason: outcome.skipReason,
      partition: classifySkip(
        outcome.skipReason,
        outcome.contractName,
        ctx.registeredByConcreteClasses,
      ),
      ...(gloss !== undefined ? { gloss } : {}),
      contractName: outcome.contractName,
      ...(outcome.baseClassName !== undefined
        ? { baseClassName: outcome.baseClassName }
        : {}),
    },
  ];
};

const isDiscoveryFilesArray = (
  input: DiscoveryReportInput,
): input is IocDiscoveryAnalysisFiles => Array.isArray(input);

/** Flattens one variant's stage-2 result into report rows (no AST, no checker types). */
const toVerificationRow = (
  verification: ScopeRootVariantVerification,
): DiscoveryScopeRootVerificationRow => ({
  satisfied: verification.satisfied,
  scopeDemands: verification.scopeDemands.map((demand) => ({
    key: demand.key,
    satisfiedBy: demand.satisfiedBy,
    via: [...demand.viaPath, demand.key].join(" → "),
    ...(demand.demandedTypeText !== undefined
      ? { demandedTypeText: demand.demandedTypeText }
      : {}),
    ...(demand.suppliedTypeText !== undefined
      ? { suppliedTypeText: demand.suppliedTypeText }
      : {}),
  })),
  generationResolvedKeys: verification.generationResolvedKeys.map((entry) => ({
    key: entry.key,
    via: entry.via,
    path: [...entry.viaPath, entry.key].join(" → "),
  })),
  unusedDeclaredKeys: verification.unusedDeclaredKeys,
  blindComposedPackages: verification.blindComposedPackages,
  findings: verification.findings.map((finding) => ({
    severity: finding.severity,
    code: finding.code,
    key: finding.key,
    message: finding.message,
  })),
});

/**
 * Groups scope-root units by their root contract. Units sharing a contract are variants of one
 * scope root; the variant is the factory identity, so grouping needs no type-level analysis.
 */
const buildScopeRootRows = (
  units: readonly DiscoveredScopeRoot[],
  verificationByVariant: ReadonlyMap<string, ScopeRootVariantVerification>,
): DiscoveryScopeRootRow[] => {
  const byContract = new Map<string, DiscoveryScopeRootRow>();

  for (const unit of units) {
    const row = byContract.get(unit.contractName) ?? {
      contractName: unit.contractName,
      lifetime: unit.lifetime,
      variants: [] as DiscoveryScopeRootVariantRow[],
    };
    const variantVerification = verificationByVariant.get(
      factoryJoinKey(unit.modulePath, unit.exportName),
    );
    (row.variants as DiscoveryScopeRootVariantRow[]).push({
      variantName: unit.variantName,
      exportName: unit.exportName,
      modulePath: unit.modulePath,
      openerKey: variantNameToOpenerKey(unit.variantName),
      declaredLbv: unit.lbvTypeText,
      ...(variantVerification !== undefined
        ? {
            declaredKeys: variantVerification.declaredKeys,
            verification: toVerificationRow(variantVerification),
          }
        : {}),
    });
    byContract.set(unit.contractName, row);
  }

  return Array.from(byContract.values())
    .sort((a, b) => a.contractName.localeCompare(b.contractName))
    .map((row) => ({
      ...row,
      variants: [...row.variants].sort((a, b) =>
        a.variantName.localeCompare(b.variantName),
      ),
    }));
};

/**
 * Synthetic rows for files the config excluded.
 *
 * The `excluded_by_config` skip reason is **never emitted by the scanner** — an excluded file never
 * enters the scan set, so nothing parses it and nothing records an outcome for it. These rows are
 * the only source of that reason. Do not go looking for a scanner emission path; there isn't one,
 * and adding one would mean scanning the files the config asked us to skip.
 */
const buildExcludedFileEntries = (
  excludedFiles: readonly string[],
): {
  modulePath: string;
  rows: readonly DiscoveryExportReportRow[];
}[] =>
  [...excludedFiles]
    .sort((a, b) => a.localeCompare(b))
    .map((modulePath) => ({
      modulePath,
      rows: [
        {
          modulePath,
          status: "skipped" as const,
          skipReason: IocDiscoverySkipReason.EXCLUDED_BY_CONFIG,
          partition: partitionForSkipReason(
            IocDiscoverySkipReason.EXCLUDED_BY_CONFIG,
          ),
        },
      ],
    }));

const summarize = (
  scannedFiles: readonly {
    modulePath: string;
    rows: readonly DiscoveryExportReportRow[];
  }[],
  filesExcludedByConfig: number,
): DiscoverySummary => {
  let unitsDiscovered = 0;
  let nearMisses = 0;
  let notACandidateFiles = 0;

  for (const file of scannedFiles) {
    let visible = 0;
    for (const row of file.rows) {
      if (row.status === "discovered") {
        unitsDiscovered += 1;
        visible += 1;
        continue;
      }
      if (row.partition === "near_miss") {
        nearMisses += 1;
        visible += 1;
      }
    }
    if (visible === 0) {
      notACandidateFiles += 1;
    }
  }

  return {
    filesScanned: scannedFiles.length,
    unitsDiscovered,
    nearMisses,
    notACandidateFiles,
    filesExcludedByConfig,
  };
};

export const buildDiscoveryReport = (
  analysisOrFiles: DiscoveryReportInput,
): DiscoveryReport => {
  const asObject = isDiscoveryFilesArray(analysisOrFiles)
    ? undefined
    : analysisOrFiles;
  const discoveryFiles: IocDiscoveryAnalysisFiles = isDiscoveryFilesArray(
    analysisOrFiles,
  )
    ? analysisOrFiles
    : analysisOrFiles.discoveryFiles;

  // Variant identity — (modulePath, exportName) — is what joins a unit to its verification. Never
  // the contract name: variants of one root have different declarations and different results.
  const verificationByVariant = new Map(
    (asObject?.scopeRootVerification?.variants ?? []).map((v) => [
      factoryJoinKey(v.modulePath, v.exportName),
      v,
    ]),
  );

  const ctx: RowBuildContext = {
    registeredByConcreteClasses:
      contractsRegisteredByConcreteClasses(discoveryFiles),
    plan: buildPlanJoin(asObject?.registrationPlan),
    verificationByVariant,
  };

  const scannedFiles = discoveryFiles
    .slice()
    .sort((a, b) => a.modulePath.localeCompare(b.modulePath))
    .map((file) => ({
      modulePath: file.modulePath,
      rows: file.outcomes.flatMap((o) =>
        outcomeToRows(file.modulePath, o, ctx),
      ),
    }));

  const excludedByConfig = [...(asObject?.excludedFiles ?? [])].sort((a, b) =>
    a.localeCompare(b),
  );
  // Excluded files join the row list so `--verbose` and `--json` can see them, but they are kept
  // out of the scan counts: they never entered the scan, so calling them "scanned" would be a lie
  // of exactly the kind this footer line exists to remove.
  const files = [
    ...scannedFiles,
    ...buildExcludedFileEntries(excludedByConfig),
  ].sort((a, b) => a.modulePath.localeCompare(b.modulePath));

  return {
    files,
    scopeRoots: buildScopeRootRows(
      asObject?.scopeRoots ?? [],
      verificationByVariant,
    ),
    scopeRootSharedUnits: asObject?.scopeRootSharedUnits ?? [],
    groups: buildGroupReportsFromPlans(asObject?.groupPlans ?? []),
    excludedByConfig,
    summary: summarize(scannedFiles, excludedByConfig.length),
  };
};

const containsFold = (haystack: string | undefined, needle: string): boolean =>
  haystack !== undefined && haystack.toLowerCase().includes(needle);

const groupMatchesContract = (
  group: InspectionGroupReport,
  needle: string,
): boolean =>
  containsFold(group.groupName, needle) ||
  containsFold(group.baseType, needle) ||
  group.members.some((m) => containsFold(m.memberName, needle)) ||
  group.rejections.some((r) => containsFold(r.contractName, needle));

/**
 * Narrows a discovery report to rows whose contract or export name contains `contract`
 * (case-insensitive). {@link DiscoveryReport.summary} is deliberately carried over untouched: the
 * footer answers "what did the scan do", which a filter must not silently rewrite.
 */
export const filterDiscoveryReportByContract = (
  report: DiscoveryReport,
  contract: string,
): DiscoveryReport => {
  const needle = contract.toLowerCase();

  const files = report.files
    .map((file) => ({
      modulePath: file.modulePath,
      rows: file.rows.filter(
        (row) =>
          containsFold(row.contractName, needle) ||
          containsFold(row.exportName, needle),
      ),
    }))
    .filter((file) => file.rows.length > 0);

  const scopeRoots = report.scopeRoots
    .map((root) => ({
      ...root,
      variants: containsFold(root.contractName, needle)
        ? root.variants
        : root.variants.filter(
            (v) =>
              containsFold(v.variantName, needle) ||
              containsFold(v.exportName, needle),
          ),
    }))
    .filter((root) => root.variants.length > 0);

  return {
    files,
    scopeRoots,
    scopeRootSharedUnits: report.scopeRootSharedUnits.filter(
      (u) =>
        containsFold(u.key, needle) ||
        containsFold(u.exportName, needle) ||
        u.declaringVariants.some((v) => containsFold(v, needle)),
    ),
    groups: report.groups.filter((g) => groupMatchesContract(g, needle)),
    // Not narrowed: an excluded file has no contract to match against, and the list is a statement
    // about the config rather than about the rows the filter selected.
    excludedByConfig: report.excludedByConfig,
    summary: report.summary,
    filter: { contract },
  };
};

/** Narrows an inspection report to contracts (and groups) matching `contract`, case-insensitively. */
export const filterInspectionReportByContract = (
  report: InspectionReport,
  contract: string,
): InspectionReport => {
  const needle = contract.toLowerCase();

  return {
    contracts: report.contracts.filter((c) =>
      containsFold(c.contractName, needle),
    ),
    manifestIssues: report.manifestIssues,
    groups: report.groups.filter((g) => groupMatchesContract(g, needle)),
    openers: report.openers.filter(
      (o) =>
        containsFold(o.contractName, needle) ||
        containsFold(o.variantName, needle) ||
        containsFold(o.openerKey, needle),
    ),
    filter: { contract },
    totalContractCount: report.totalContractCount,
  };
};
