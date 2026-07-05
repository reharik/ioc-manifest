/**
 * @fileoverview Builds `IocGroupsManifest` from config `groups` plus assignability against a
 * named base type. `buildGroupPlan` throws on issues; `analyzeGroupPlan` returns structured errors
 * for tooling that must not abort the process.
 */
import type * as ts from "typescript";
import {
  collectContractDefaultMembersAssignableToBase,
  collectImplementationMembersAssignableToBase,
  getBaseTypeParameterInfo,
  resolveDeclaredBaseType,
  shouldIncludeImplInCollectionGroup,
  type AssignableImplementationMember,
  type ContractDefaultGroupMember,
} from "./baseTypeAssignability.js";
import {
  IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS,
  type IocGroupNodeManifest,
  type IocGroupObjectManifest,
  type IocGroupRootManifest,
  type IocGroupsManifest,
} from "../core/manifest.js";
import {
  resolveBaseTypeFromCanonicalId,
  resolveCanonicalBaseTypeId,
} from "./canonicalBaseTypeId.js";
import type { ResolvedScanDir } from "../generator/manifestPaths.js";
import type { ResolvedContractRegistration } from "../generator/resolveRegistrationPlan.js";

/** TypeScript program + paths used to map stored contract type specifiers back to source files. */
export type GroupDiscoveryBuildContext = {
  program: ts.Program;
  generatedDir: string;
  scanDirs: readonly ResolvedScanDir[];
};

export type IocGroupKind = "collection" | "object";

export type IocGroupDefinition = {
  kind: IocGroupKind;
  baseType: string;
  /**
   * Type argument for a generic `baseType`, as the source text of a type the program can resolve
   * (e.g. a constraint type name for a bounded-heterogeneous group, or a literal-alias name for a
   * homogeneous group). Every member's bound arg must be assignable to it, checked at generation.
   * Required when `baseType` has a required (non-defaulted) type parameter; a config error when
   * `baseType` is non-generic.
   */
  baseTypeArg?: string;
};

export type IocGroupsConfig = Record<string, IocGroupDefinition>;

export type GroupPlan =
  | {
      groupName: string;
      kind: "collection";
      baseType: string;
      baseTypeId: string;
      baseTypeArg?: string;
      members: readonly AssignableImplementationMember[];
    }
  | {
      groupName: string;
      kind: "object";
      baseType: string;
      baseTypeId: string;
      baseTypeArg?: string;
      members: readonly ContractDefaultGroupMember[];
    };

export type GroupPlanIssue =
  | { kind: "groups_not_object" }
  | { kind: "group_invalid_entry"; groupName: string }
  | { kind: "group_unknown_base_type"; groupName: string; message: string }
  | {
      kind: "group_duplicate_contract_key";
      groupName: string;
      contractKey: string;
    }
  | { kind: "group_root_key_collision"; key: string }
  | { kind: "group_root_key_reserved_manifest"; key: string }
  | { kind: "group_discovery_missing_context" }
  | {
      kind: "group_base_not_generic";
      groupName: string;
      baseType: string;
    }
  | {
      kind: "group_generic_base_missing_arg";
      groupName: string;
      baseType: string;
    }
  | {
      kind: "group_unknown_base_type_arg";
      groupName: string;
      baseTypeArg: string;
      message: string;
    }
  | {
      kind: "group_member_arg_not_assignable";
      groupName: string;
      contractName: string;
      memberArg: string;
      declaredArg: string;
    };

export type GroupPlanResult = {
  plans: readonly GroupPlan[];
  manifest: IocGroupsManifest;
};

const collectReservedCradleKeys = (
  plans: readonly ResolvedContractRegistration[],
): Set<string> => {
  const reserved = new Set<string>();

  for (const plan of plans) {
    reserved.add(plan.accessKey);

    for (const implementation of plan.implementations) {
      reserved.add(implementation.registrationKey);
    }
  }

  return reserved;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isValidGroupKind = (value: unknown): value is IocGroupKind =>
  value === "collection" || value === "object";

const validateGroupDefinition = (
  groupName: string,
  raw: unknown,
): GroupPlanIssue | undefined => {
  if (!isRecord(raw)) {
    return { kind: "group_invalid_entry", groupName };
  }

  const kind = raw.kind;
  const baseType = raw.baseType;

  if (!isValidGroupKind(kind)) {
    return { kind: "group_invalid_entry", groupName };
  }

  if (typeof baseType !== "string" || baseType.length === 0) {
    return { kind: "group_invalid_entry", groupName };
  }

  if (
    raw.baseTypeArg !== undefined &&
    (typeof raw.baseTypeArg !== "string" || raw.baseTypeArg.length === 0)
  ) {
    return { kind: "group_invalid_entry", groupName };
  }

  const extraKeys = Object.keys(raw).filter(
    (key) => key !== "kind" && key !== "baseType" && key !== "baseTypeArg",
  );
  if (extraKeys.length > 0) {
    return { kind: "group_invalid_entry", groupName };
  }

  return undefined;
};

/**
 * Serializes a member's captured type argument to source text for the manifest leaf. Requires the
 * checker; omitted when absent (callers without a checker — e.g. non-generic-group unit tests — get
 * leaves without `typeArgument`).
 */
const memberTypeArgumentText = (
  member: AssignableImplementationMember | ContractDefaultGroupMember,
  checker: ts.TypeChecker | undefined,
): { typeArgument: string } | Record<string, never> =>
  member.typeArgument !== undefined && checker !== undefined
    ? { typeArgument: checker.typeToString(member.typeArgument) }
    : {};

export const groupPlanToManifestNode = (
  plan: GroupPlan,
  checker?: ts.TypeChecker,
): IocGroupNodeManifest => {
  if (plan.kind === "collection") {
    return plan.members.map((member) => ({
      contractName: member.contractName,
      registrationKey: member.registrationKey,
      ...memberTypeArgumentText(member, checker),
    }));
  }

  const out: IocGroupObjectManifest = {};

  for (const member of plan.members) {
    out[member.contractKey] = {
      contractName: member.contractName,
      registrationKey: member.registrationKey,
      ...memberTypeArgumentText(member, checker),
    };
  }

  return out;
};

export const groupPlanToManifestRoot = (
  plan: GroupPlan,
  checker?: ts.TypeChecker,
): IocGroupRootManifest => ({
  kind: plan.kind,
  baseType: plan.baseType,
  baseTypeId: plan.baseTypeId,
  ...(plan.baseTypeArg !== undefined ? { baseTypeArg: plan.baseTypeArg } : {}),
  members: groupPlanToManifestNode(plan, checker),
});

const buildObjectGroupMembersOrIssue = (
  groupName: string,
  members: readonly ContractDefaultGroupMember[],
):
  | { ok: true; members: ContractDefaultGroupMember[] }
  | { ok: false; issue: GroupPlanIssue } => {
  const seen = new Set<string>();

  for (const member of members) {
    if (seen.has(member.contractKey)) {
      return {
        ok: false,
        issue: {
          kind: "group_duplicate_contract_key",
          groupName,
          contractKey: member.contractKey,
        },
      };
    }

    seen.add(member.contractKey);
  }

  return { ok: true, members: [...members] };
};

export const formatGroupPlanIssue = (issue: GroupPlanIssue): string => {
  switch (issue.kind) {
    case "groups_not_object":
      return "[ioc-config] groups must be an object when set";

    case "group_invalid_entry":
      return `[ioc-config] groups.${JSON.stringify(issue.groupName)} must be { kind: "collection" | "object", baseType: string }`;

    case "group_unknown_base_type":
      return `[ioc-config] groups.${JSON.stringify(issue.groupName)}: ${issue.message}`;

    case "group_duplicate_contract_key":
      return `[ioc-config] groups.${JSON.stringify(issue.groupName)}: duplicate contract key ${JSON.stringify(issue.contractKey)} in object group`;

    case "group_root_key_collision":
      return `[ioc-config] groups root key ${JSON.stringify(issue.key)} collides with an existing Awilix registration key`;

    case "group_root_key_reserved_manifest":
      return `[ioc-config] groups root key ${JSON.stringify(issue.key)} is reserved for the generated container manifest (use a different group name)`;

    case "group_discovery_missing_context":
      return "[ioc-config] groups require TypeScript program context (program, generatedDir, scanDirs). Use the IoC manifest generator or pass GroupDiscoveryBuildContext into buildGroupPlan.";

    case "group_base_not_generic":
      return `[ioc-config] groups.${JSON.stringify(issue.groupName)}: base type ${JSON.stringify(issue.baseType)} is not generic, so baseTypeArg must not be declared`;

    case "group_generic_base_missing_arg":
      return `[ioc-config] groups.${JSON.stringify(issue.groupName)}: base type ${JSON.stringify(issue.baseType)} is generic with a required type parameter; declare groups.${JSON.stringify(issue.groupName)}.baseTypeArg to bound the group`;

    case "group_unknown_base_type_arg":
      return `[ioc-config] groups.${JSON.stringify(issue.groupName)}: baseTypeArg ${JSON.stringify(issue.baseTypeArg)}: ${issue.message}`;

    case "group_member_arg_not_assignable":
      return `[ioc-config] groups.${JSON.stringify(issue.groupName)}: member ${JSON.stringify(issue.contractName)} binds ${JSON.stringify(issue.memberArg)} to the base type argument, which is not assignable to the group's declared arg ${JSON.stringify(issue.declaredArg)}`;

    default: {
      const exhaustive: never = issue;
      return String(exhaustive);
    }
  }
};

export const formatGroupPlanIssues = (
  issues: readonly GroupPlanIssue[],
): string => issues.map((issue) => formatGroupPlanIssue(issue)).join("\n");

export const formatEmptyGroupWarning = (
  groupName: string,
  baseType: string,
): string =>
  `[ioc-warn] Group ${JSON.stringify(groupName)} base type ${JSON.stringify(baseType)} has no declared extenders in this package.\n` +
  `The group will be empty. If you expected members, ensure your implementations declare \`extends ${baseType}\`.`;

const warnOnEmptyGroup = (groupName: string, baseType: string): void => {
  console.warn(formatEmptyGroupWarning(groupName, baseType));
};

const runGroupPlan = (
  groups: unknown,
  plans: readonly ResolvedContractRegistration[],
  discovery: GroupDiscoveryBuildContext | undefined,
):
  | { ok: true; plans: GroupPlan[]; manifest: IocGroupsManifest }
  | { ok: false; issues: GroupPlanIssue[] } => {
  if (!isRecord(groups)) {
    return { ok: false, issues: [{ kind: "groups_not_object" }] };
  }

  if (discovery === undefined) {
    return { ok: false, issues: [{ kind: "group_discovery_missing_context" }] };
  }

  const checker = discovery.program.getTypeChecker();
  const reserved = collectReservedCradleKeys(plans);
  const groupPlans: GroupPlan[] = [];
  const issues: GroupPlanIssue[] = [];

  const sortedGroupNames = Object.keys(groups).sort((a, b) =>
    a.localeCompare(b),
  );

  for (const groupName of sortedGroupNames) {
    if (IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS.has(groupName)) {
      issues.push({ kind: "group_root_key_reserved_manifest", key: groupName });
      continue;
    }

    if (reserved.has(groupName)) {
      issues.push({ kind: "group_root_key_collision", key: groupName });
      continue;
    }

    const definitionIssue = validateGroupDefinition(
      groupName,
      groups[groupName],
    );
    if (definitionIssue !== undefined) {
      issues.push(definitionIssue);
      continue;
    }

    const entry = groups[groupName] as IocGroupDefinition;
    const canonical = resolveCanonicalBaseTypeId(checker, discovery, entry.baseType);

    if (!canonical.ok) {
      issues.push({
        kind: "group_unknown_base_type",
        groupName,
        message: canonical.message,
      });
      continue;
    }

    const declaredBase = resolveDeclaredBaseType(
      discovery.program,
      checker,
      entry.baseType,
    );
    const resolvedBase = declaredBase.ok
      ? declaredBase
      : resolveBaseTypeFromCanonicalId(
          discovery.program,
          checker,
          canonical.baseTypeId,
        );

    if (!resolvedBase.ok) {
      issues.push({
        kind: "group_unknown_base_type",
        groupName,
        message: resolvedBase.message,
      });
      continue;
    }

    // Generic base + declared-arg gate. A non-generic base must not declare an arg; a base with a
    // required (non-defaulted) type parameter must declare one (bare emission is the TS2314 bug we
    // reject). A defaulted-only base may omit the arg (its default applies, no bounded emission).
    const baseInfo = getBaseTypeParameterInfo(checker, resolvedBase.type);
    if (baseInfo.arity === 0 && entry.baseTypeArg !== undefined) {
      issues.push({
        kind: "group_base_not_generic",
        groupName,
        baseType: entry.baseType,
      });
      continue;
    }
    if (baseInfo.requiredCount > 0 && entry.baseTypeArg === undefined) {
      issues.push({
        kind: "group_generic_base_missing_arg",
        groupName,
        baseType: entry.baseType,
      });
      continue;
    }

    let declaredArgType: ts.Type | undefined;
    if (entry.baseTypeArg !== undefined) {
      const argResolution = resolveDeclaredBaseType(
        discovery.program,
        checker,
        entry.baseTypeArg,
      );
      if (!argResolution.ok) {
        issues.push({
          kind: "group_unknown_base_type_arg",
          groupName,
          baseTypeArg: entry.baseTypeArg,
          message: argResolution.message,
        });
        continue;
      }
      declaredArgType = argResolution.type;
    }

    // Aggregating gate: every member's bound arg must extend the declared arg (same satisfaction
    // direction as the externals check). Collects one issue per offending member so a group with
    // two bad members surfaces both in the single aggregated throw.
    const collectMemberArgIssues = (
      members: readonly (
        | AssignableImplementationMember
        | ContractDefaultGroupMember
      )[],
    ): GroupPlanIssue[] => {
      if (declaredArgType === undefined || entry.baseTypeArg === undefined) {
        return [];
      }
      const argIssues: GroupPlanIssue[] = [];
      const seenContracts = new Set<string>();
      for (const member of members) {
        if (seenContracts.has(member.contractName)) {
          continue;
        }
        seenContracts.add(member.contractName);
        if (member.typeArgument === undefined) {
          continue;
        }
        if (!checker.isTypeAssignableTo(member.typeArgument, declaredArgType)) {
          argIssues.push({
            kind: "group_member_arg_not_assignable",
            groupName,
            contractName: member.contractName,
            memberArg: checker.typeToString(member.typeArgument),
            declaredArg: entry.baseTypeArg,
          });
        }
      }
      return argIssues;
    };

    const baseTypeArgField =
      entry.baseTypeArg !== undefined
        ? { baseTypeArg: entry.baseTypeArg }
        : {};

    if (entry.kind === "object") {
      const objectMembers = collectContractDefaultMembersAssignableToBase(
        checker,
        discovery.program,
        discovery.generatedDir,
        discovery.scanDirs,
        plans,
        resolvedBase.type,
      );

      if (objectMembers.length === 0) {
        warnOnEmptyGroup(groupName, entry.baseType);
        reserved.add(groupName);
        groupPlans.push({
          groupName,
          kind: "object",
          baseType: entry.baseType,
          baseTypeId: canonical.baseTypeId,
          ...baseTypeArgField,
          members: [],
        });
        continue;
      }

      const argIssues = collectMemberArgIssues(objectMembers);
      if (argIssues.length > 0) {
        issues.push(...argIssues);
        continue;
      }

      const built = buildObjectGroupMembersOrIssue(groupName, objectMembers);
      if (!built.ok) {
        issues.push(built.issue);
        continue;
      }

      reserved.add(groupName);
      groupPlans.push({
        groupName,
        kind: "object",
        baseType: entry.baseType,
        baseTypeId: canonical.baseTypeId,
        ...baseTypeArgField,
        members: built.members,
      });
      continue;
    }

    const members = collectImplementationMembersAssignableToBase(
      checker,
      discovery.program,
      discovery.generatedDir,
      discovery.scanDirs,
      plans,
      resolvedBase.type,
      shouldIncludeImplInCollectionGroup,
    );

    if (members.length === 0) {
      warnOnEmptyGroup(groupName, entry.baseType);
      reserved.add(groupName);
      groupPlans.push({
        groupName,
        kind: "collection",
        baseType: entry.baseType,
        baseTypeId: canonical.baseTypeId,
        ...baseTypeArgField,
        members: [],
      });
      continue;
    }

    const argIssues = collectMemberArgIssues(members);
    if (argIssues.length > 0) {
      issues.push(...argIssues);
      continue;
    }

    reserved.add(groupName);
    groupPlans.push({
      groupName,
      kind: "collection",
      baseType: entry.baseType,
      baseTypeId: canonical.baseTypeId,
      ...baseTypeArgField,
      members,
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const manifest: IocGroupsManifest = {};
  for (const plan of groupPlans) {
    manifest[plan.groupName] = groupPlanToManifestRoot(plan, checker);
  }

  return { ok: true, plans: groupPlans, manifest };
};

/**
 * Validates group definitions and emits the manifest subtree for generated `ioc-manifest.ts`.
 * Requires `discovery` (TypeScript program + `generatedDir` + `scanDirs`) whenever `groups` is set.
 */
export const buildGroupPlan = (
  groups: unknown,
  plans: readonly ResolvedContractRegistration[],
  discovery: GroupDiscoveryBuildContext | undefined,
): GroupPlanResult | undefined => {
  if (groups === undefined) {
    return undefined;
  }

  const result = runGroupPlan(groups, plans, discovery);
  if (!result.ok) {
    throw new Error(formatGroupPlanIssues(result.issues));
  }

  return { plans: result.plans, manifest: result.manifest };
};

export type GroupPlanAnalysis =
  | {
      ok: true;
      plans: readonly GroupPlan[];
      manifest: IocGroupsManifest | undefined;
      issues: readonly [];
    }
  | {
      ok: false;
      plans: readonly [];
      manifest: undefined;
      issues: readonly GroupPlanIssue[];
    };

/** Non-throwing variant of `buildGroupPlan` for inspectors and CI that collect all issues. */
export const analyzeGroupPlan = (
  groups: unknown,
  plans: readonly ResolvedContractRegistration[],
  discovery: GroupDiscoveryBuildContext | undefined,
): GroupPlanAnalysis => {
  if (groups === undefined) {
    return { ok: true, plans: [], manifest: undefined, issues: [] };
  }

  const result = runGroupPlan(groups, plans, discovery);
  if (!result.ok) {
    return {
      ok: false,
      plans: [],
      manifest: undefined,
      issues: result.issues,
    };
  }

  return {
    ok: true,
    plans: result.plans,
    manifest: result.manifest,
    issues: [],
  };
};
