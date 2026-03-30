/**
 * @fileoverview Builds `IocGroupsManifest` from config `groups` plus assignability against a
 * named base type. `buildGroupPlan` throws on issues; `analyzeGroupPlan` returns structured errors
 * for tooling that must not abort the process.
 */
import type * as ts from "typescript";
import {
  collectContractDefaultMembersAssignableToBase,
  collectImplementationMembersAssignableToBase,
  resolveDeclaredBaseType,
  shouldIncludeImplInCollectionGroup,
  type AssignableImplementationMember,
  type ContractDefaultGroupMember,
} from "./baseTypeAssignability.js";
import {
  IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS,
  type IocGroupNodeManifest,
  type IocGroupsManifest,
} from "../core/manifest.js";
import type { ResolvedContractRegistration } from "../generator/resolveRegistrationPlan.js";

/** TypeScript program + generated dir path contract types resolve against. */
export type GroupDiscoveryBuildContext = {
  program: ts.Program;
  generatedDir: string;
};

export type IocGroupKind = "collection" | "object";

export type IocGroupDefinition = {
  kind: IocGroupKind;
  baseType: string;
};

export type IocGroupsConfig = Record<string, IocGroupDefinition>;

export type GroupPlan =
  | {
      groupName: string;
      kind: "collection";
      baseType: string;
      members: readonly AssignableImplementationMember[];
    }
  | {
      groupName: string;
      kind: "object";
      baseType: string;
      members: readonly ContractDefaultGroupMember[];
    };

export type GroupPlanIssue =
  | { kind: "groups_not_object" }
  | { kind: "group_invalid_entry"; groupName: string }
  | { kind: "group_unknown_base_type"; groupName: string; message: string }
  | { kind: "group_no_matches"; groupName: string; baseType: string }
  | {
      kind: "group_duplicate_contract_key";
      groupName: string;
      contractKey: string;
    }
  | { kind: "group_root_key_collision"; key: string }
  | { kind: "group_root_key_reserved_manifest"; key: string }
  | { kind: "group_discovery_missing_context" };

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

    if (plan.collectionKey !== undefined) {
      reserved.add(plan.collectionKey);
    }

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

  const extraKeys = Object.keys(raw).filter(
    (key) => key !== "kind" && key !== "baseType",
  );
  if (extraKeys.length > 0) {
    return { kind: "group_invalid_entry", groupName };
  }

  return undefined;
};

export const groupPlanToManifestNode = (
  plan: GroupPlan,
): IocGroupNodeManifest => {
  if (plan.kind === "collection") {
    return plan.members.map((member) => ({
      contractName: member.contractName,
      registrationKey: member.registrationKey,
    }));
  }

  const out: Record<string, { contractName: string; registrationKey: string }> =
    {};

  for (const member of plan.members) {
    out[member.contractKey] = {
      contractName: member.contractName,
      registrationKey: member.registrationKey,
    };
  }

  return out;
};

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

    case "group_no_matches":
      return `[ioc-config] groups.${JSON.stringify(issue.groupName)}: no implementations found for base type ${JSON.stringify(issue.baseType)}`;

    case "group_duplicate_contract_key":
      return `[ioc-config] groups.${JSON.stringify(issue.groupName)}: duplicate contract key ${JSON.stringify(issue.contractKey)} in object group`;

    case "group_root_key_collision":
      return `[ioc-config] groups root key ${JSON.stringify(issue.key)} collides with an existing Awilix registration key`;

    case "group_root_key_reserved_manifest":
      return `[ioc-config] groups root key ${JSON.stringify(issue.key)} is reserved for the generated container manifest (use a different group name)`;

    case "group_discovery_missing_context":
      return "[ioc-config] groups require TypeScript program context. Use the IoC manifest generator or pass GroupDiscoveryBuildContext into buildGroupPlan.";

    default: {
      const exhaustive: never = issue;
      return String(exhaustive);
    }
  }
};

export const formatGroupPlanIssues = (
  issues: readonly GroupPlanIssue[],
): string => issues.map((issue) => formatGroupPlanIssue(issue)).join("\n");

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
    const base = resolveDeclaredBaseType(
      discovery.program,
      checker,
      entry.baseType,
    );

    if (!base.ok) {
      issues.push({
        kind: "group_unknown_base_type",
        groupName,
        message: base.message,
      });
      continue;
    }

    if (entry.kind === "object") {
      const objectMembers = collectContractDefaultMembersAssignableToBase(
        checker,
        discovery.program,
        discovery.generatedDir,
        plans,
        base.type,
      );

      if (objectMembers.length === 0) {
        issues.push({
          kind: "group_no_matches",
          groupName,
          baseType: entry.baseType,
        });
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
        members: built.members,
      });
      continue;
    }

    const members = collectImplementationMembersAssignableToBase(
      checker,
      discovery.program,
      discovery.generatedDir,
      plans,
      base.type,
      shouldIncludeImplInCollectionGroup,
    );

    if (members.length === 0) {
      issues.push({
        kind: "group_no_matches",
        groupName,
        baseType: entry.baseType,
      });
      continue;
    }

    reserved.add(groupName);
    groupPlans.push({
      groupName,
      kind: "collection",
      baseType: entry.baseType,
      members,
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const manifest: IocGroupsManifest = {};
  for (const plan of groupPlans) {
    manifest[plan.groupName] = groupPlanToManifestNode(plan);
  }

  return { ok: true, plans: groupPlans, manifest };
};

/**
 * Validates group definitions and emits the manifest subtree for generated `ioc-manifest.ts`.
 * Requires `discovery` (TypeScript program + `generatedDir`) whenever `groups` is set.
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
