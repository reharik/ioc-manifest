import type * as ts from "typescript";
import type { IocBundleArrayInsight } from "../core/manifest.js";
import type { ResolvedContractRegistration } from "../generator/resolveRegistrationPlan.js";
import {
  bundleTreeContainsDiscover,
  expandBundleDiscoveryInTree,
} from "./expandBundleDiscovery.js";
import { pickSimilarKeys } from "./bundleKeySuggestions.js";
import type { IocBundleDiscoverMarker } from "./bundleDiscovery.types.js";

const collectReservedCradleKeys = (
  plans: readonly ResolvedContractRegistration[],
): Set<string> => {
  const reserved = new Set<string>();
  for (const plan of plans) {
    reserved.add(plan.contractKey);
    if (plan.collectionKey !== undefined) {
      reserved.add(plan.collectionKey);
    }
    for (const impl of plan.implementations) {
      reserved.add(impl.registrationKey);
    }
  }
  return reserved;
};

export type IocBundleReference = {
  $bundleRef: string;
};

export type IocBundleLeaf = string | IocBundleReference;
export interface IocBundleTree {
  [key: string]: IocBundleNode;
}
export type IocBundleNode =
  | IocBundleTree
  | readonly IocBundleLeaf[]
  | IocBundleDiscoverMarker;
export type IocBundlesConfig = IocBundleTree;

/** When set, `$discover` bundle leaves are expanded using assignability against the named base type. */
export type BundleDiscoveryBuildContext = {
  program: ts.Program;
  generatedDir: string;
};

export type ResolvedBundleLeaf = {
  contractName: string;
  registrationKey: string;
};

export interface ResolvedBundleTree {
  [key: string]: ResolvedBundleNode;
}
export type ResolvedBundleNode = ResolvedBundleTree | ResolvedBundleLeaf[];

export type BundlePlanIssue =
  | { kind: "bundles_not_object" }
  | { kind: "invalid_node_shape"; path: string }
  | { kind: "invalid_array_item"; path: string; index: number }
  | { kind: "empty_contract_string"; path: string; index: number }
  | {
      kind: "unknown_contract";
      path: string;
      index: number;
      contractName: string;
      knownContracts: string[];
    }
  | {
      kind: "unknown_bundle_ref";
      path: string;
      index: number;
      reference: string;
      knownBundlePaths: string[];
    }
  | { kind: "bundle_cycle"; cycle: string[] }
  | { kind: "bundle_root_must_be_object" }
  | { kind: "bundle_root_key_collision"; key: string }
  | { kind: "bundle_discovery"; path: string; message: string }
  | { kind: "bundle_discovery_missing_context" };

export type BundlePlanResult = {
  tree: ResolvedBundleTree;
  arraysInsight: IocBundleArrayInsight[];
};

type RawBundleArrayItem = string | IocBundleReference;
type RawBundleArray = readonly RawBundleArrayItem[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBundleReference = (value: unknown): value is IocBundleReference => {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "$bundleRef") {
    return false;
  }
  return typeof value.$bundleRef === "string" && value.$bundleRef.length > 0;
};

const bundlePathToLabel = (segments: readonly string[]): string => {
  if (segments.length === 0) {
    return "bundles";
  }
  return `bundles.${segments.join(".")}`;
};

const validateRawArrayItemsSoft = (
  arrayPath: readonly string[],
  items: readonly unknown[],
):
  | { ok: true; items: RawBundleArray }
  | { ok: false; issue: BundlePlanIssue } => {
  const out: RawBundleArrayItem[] = [];
  const path = arrayPath.join(".");
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (typeof item === "string") {
      if (item.length === 0) {
        return {
          ok: false,
          issue: { kind: "empty_contract_string", path, index },
        };
      }
      out.push(item);
      continue;
    }
    if (isBundleReference(item)) {
      out.push(item);
      continue;
    }
    return {
      ok: false,
      issue: { kind: "invalid_array_item", path, index },
    };
  }
  return { ok: true, items: out };
};

const collectBundleArraysSoft = (
  node: unknown,
  pathSegments: string[],
  arraysByPath: Map<string, RawBundleArray>,
): BundlePlanIssue[] => {
  if (Array.isArray(node)) {
    const path = pathSegments.join(".");
    const validated = validateRawArrayItemsSoft(pathSegments, node);
    if (!validated.ok) {
      return [validated.issue];
    }
    arraysByPath.set(path, validated.items);
    return [];
  }

  if (!isRecord(node)) {
    return [{ kind: "invalid_node_shape", path: pathSegments.join(".") }];
  }

  const issues: BundlePlanIssue[] = [];
  for (const [key, value] of Object.entries(node)) {
    issues.push(
      ...collectBundleArraysSoft(value, [...pathSegments, key], arraysByPath),
    );
  }
  return issues;
};

const assertReferencesSoft = (
  arraysByPath: Map<string, RawBundleArray>,
  contractsByName: Map<string, ResolvedContractRegistration>,
): BundlePlanIssue[] => {
  const issues: BundlePlanIssue[] = [];
  const knownBundlePaths = Array.from(arraysByPath.keys()).sort((a, b) =>
    a.localeCompare(b),
  );
  const knownContracts = Array.from(contractsByName.keys()).sort((a, b) =>
    a.localeCompare(b),
  );

  for (const [arrayPath, items] of arraysByPath) {
    items.forEach((item, index) => {
      if (typeof item === "string") {
        if (!contractsByName.has(item)) {
          issues.push({
            kind: "unknown_contract",
            path: arrayPath,
            index,
            contractName: item,
            knownContracts,
          });
        }
        return;
      }
      if (!arraysByPath.has(item.$bundleRef)) {
        issues.push({
          kind: "unknown_bundle_ref",
          path: arrayPath,
          index,
          reference: item.$bundleRef,
          knownBundlePaths,
        });
      }
    });
  }
  return issues;
};

const collectArrayRefs = (items: RawBundleArray): string[] =>
  items
    .filter((item): item is IocBundleReference => typeof item !== "string")
    .map((item) => item.$bundleRef);

const detectCyclesSoft = (
  arraysByPath: Map<string, RawBundleArray>,
): BundlePlanIssue | undefined => {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (path: string, stack: string[]): BundlePlanIssue | undefined => {
    if (visiting.has(path)) {
      const cycleStart = stack.indexOf(path);
      const cycle = [...stack.slice(cycleStart), path];
      return { kind: "bundle_cycle", cycle };
    }
    if (visited.has(path)) {
      return undefined;
    }

    visiting.add(path);
    const refs = collectArrayRefs(arraysByPath.get(path) ?? []);
    for (const refPath of refs) {
      const nested = visit(refPath, [...stack, path]);
      if (nested !== undefined) {
        return nested;
      }
    }
    visiting.delete(path);
    visited.add(path);
    return undefined;
  };

  for (const path of arraysByPath.keys()) {
    const issue = visit(path, []);
    if (issue !== undefined) {
      return issue;
    }
  }
  return undefined;
};

const resolveBundleArray = (
  arrayPath: string,
  arraysByPath: Map<string, RawBundleArray>,
  contractsByName: Map<string, ResolvedContractRegistration>,
  cache: Map<string, ResolvedBundleLeaf[]>,
): ResolvedBundleLeaf[] => {
  const cached = cache.get(arrayPath);
  if (cached !== undefined) {
    return cached;
  }

  const items = arraysByPath.get(arrayPath);
  if (items === undefined) {
    throw new Error(
      `[ioc-config] internal error: bundle array path ${JSON.stringify(arrayPath)} not found`,
    );
  }

  const resolved: ResolvedBundleLeaf[] = [];
  const seenContractNames = new Set<string>();

  const pushLeaf = (leaf: ResolvedBundleLeaf): void => {
    if (seenContractNames.has(leaf.contractName)) {
      return;
    }
    seenContractNames.add(leaf.contractName);
    resolved.push(leaf);
  };

  items.forEach((item) => {
    if (typeof item === "string") {
      const contract = contractsByName.get(item);
      if (contract === undefined) {
        throw new Error(
          `[ioc-config] internal error: contract ${JSON.stringify(item)} missing during bundle resolution`,
        );
      }
      pushLeaf({
        contractName: contract.contractName,
        registrationKey: contract.contractKey,
      });
      return;
    }
    const nested = resolveBundleArray(
      item.$bundleRef,
      arraysByPath,
      contractsByName,
      cache,
    );
    for (const leaf of nested) {
      pushLeaf(leaf);
    }
  });

  cache.set(arrayPath, resolved);
  return resolved;
};

const resolveBundleTree = (
  node: unknown,
  pathSegments: string[],
  arraysByPath: Map<string, RawBundleArray>,
  contractsByName: Map<string, ResolvedContractRegistration>,
  cache: Map<string, ResolvedBundleLeaf[]>,
): ResolvedBundleNode => {
  if (Array.isArray(node)) {
    return resolveBundleArray(
      pathSegments.join("."),
      arraysByPath,
      contractsByName,
      cache,
    );
  }

  if (!isRecord(node)) {
    throw new Error(
      `[ioc-config] internal error: expected object node at ${bundlePathToLabel(pathSegments)}`,
    );
  }

  const out: ResolvedBundleTree = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = resolveBundleTree(
      value,
      [...pathSegments, key],
      arraysByPath,
      contractsByName,
      cache,
    );
  }
  return out;
};

const assertBundleRootKeysSoft = (
  bundleRoot: ResolvedBundleTree,
  reserved: Set<string>,
): BundlePlanIssue[] => {
  const issues: BundlePlanIssue[] = [];
  for (const key of Object.keys(bundleRoot)) {
    if (reserved.has(key)) {
      issues.push({ kind: "bundle_root_key_collision", key });
    }
  }
  return issues;
};

export const formatBundlePlanIssue = (issue: BundlePlanIssue): string => {
  switch (issue.kind) {
    case "bundles_not_object":
      return "[ioc-config] bundles must be an object when set";
    case "invalid_node_shape":
      return `[ioc-config] bundles.${issue.path} has invalid node shape. Expected an object or an array of contract refs`;
    case "invalid_array_item":
      return `[ioc-config] bundles.${issue.path}[${issue.index}] has invalid shape. Expected contract name string or { $bundleRef: string }`;
    case "empty_contract_string":
      return `[ioc-config] bundles.${issue.path}[${issue.index}] must be a non-empty contract name string or { $bundleRef: string }`;
    case "unknown_contract": {
      const known = issue.knownContracts.map((c) => JSON.stringify(c)).join(", ");
      return `[ioc-config] bundles.${issue.path}[${issue.index}] references unknown contract ${JSON.stringify(issue.contractName)}. Known contracts: ${known}`;
    }
    case "unknown_bundle_ref": {
      const suggested = pickSimilarKeys(
        issue.reference,
        issue.knownBundlePaths,
        5,
      );
      const hint =
        suggested.length > 0
          ? ` Similar bundle paths: ${suggested.map((s) => JSON.stringify(s)).join(", ")}.`
          : "";
      return `[ioc-config] bundles.${issue.path}[${issue.index}] references unknown bundle path ${JSON.stringify(issue.reference)}. Only array bundle nodes can be referenced.${hint}`;
    }
    case "bundle_cycle": {
      const cyclePath = issue.cycle.map((p) => `bundles.${p}`).join(" -> ");
      return `[ioc-config] Circular bundle reference detected: ${cyclePath}. Remove or break the cycle so bundle expansion can finish.`;
    }
    case "bundle_root_must_be_object":
      return "[ioc-config] bundles root must be an object";
    case "bundle_root_key_collision":
      return `[ioc-config] bundles root key ${JSON.stringify(issue.key)} collides with an existing Awilix registration key (contract default, implementation, or collection). Choose a different bundles property name.`;
    case "bundle_discovery": {
      const at =
        issue.path.length > 0
          ? `bundles.${issue.path}`
          : "bundles (discovery)";
      return `[ioc-config] ${at}: ${issue.message}`;
    }
    case "bundle_discovery_missing_context":
      return "[ioc-config] bundles contain { $discover: ... } nodes but bundle resolution was run without a TypeScript program and generatedDir. Use the IoC manifest generator or pass BundleDiscoveryBuildContext into buildBundlePlan / analyzeBundlePlan.";
    default: {
      const _exhaustive: never = issue;
      return String(_exhaustive);
    }
  }
};

export const formatBundlePlanIssues = (issues: readonly BundlePlanIssue[]): string =>
  issues.map((i) => formatBundlePlanIssue(i)).join("\n");

const expandBundlesIfNeeded = (
  bundles: unknown,
  plans: readonly ResolvedContractRegistration[],
  discovery: BundleDiscoveryBuildContext | undefined,
):
  | { ok: true; bundles: unknown }
  | { ok: false; issues: BundlePlanIssue[] } => {
  if (!bundleTreeContainsDiscover(bundles)) {
    return { ok: true, bundles };
  }
  if (discovery === undefined) {
    return { ok: false, issues: [{ kind: "bundle_discovery_missing_context" }] };
  }
  const checker = discovery.program.getTypeChecker();
  const expanded = expandBundleDiscoveryInTree(
    bundles,
    checker,
    discovery.program,
    plans,
    discovery.generatedDir,
  );
  if (!expanded.ok) {
    return {
      ok: false,
      issues: expanded.issues.map((i) => ({
        kind: "bundle_discovery" as const,
        path: i.path,
        message: i.message,
      })),
    };
  }
  return { ok: true, bundles: expanded.bundles };
};

const runBundlePlan = (
  bundles: unknown,
  plans: readonly ResolvedContractRegistration[],
  discovery?: BundleDiscoveryBuildContext,
):
  | { ok: true; tree: ResolvedBundleTree; arraysByPath: Map<string, RawBundleArray> }
  | { ok: false; issues: BundlePlanIssue[] } => {
  if (!isRecord(bundles)) {
    return { ok: false, issues: [{ kind: "bundles_not_object" }] };
  }

  const expandedRoot = expandBundlesIfNeeded(bundles, plans, discovery);
  if (!expandedRoot.ok) {
    return { ok: false, issues: expandedRoot.issues };
  }
  const effectiveBundles = expandedRoot.bundles;
  if (!isRecord(effectiveBundles)) {
    return { ok: false, issues: [{ kind: "bundles_not_object" }] };
  }

  const contractsByName = new Map<string, ResolvedContractRegistration>(
    plans.map((plan) => [plan.contractName, plan]),
  );

  const arraysByPath = new Map<string, RawBundleArray>();
  const shapeIssues = collectBundleArraysSoft(effectiveBundles, [], arraysByPath);
  if (shapeIssues.length > 0) {
    return { ok: false, issues: shapeIssues };
  }

  const refIssues = assertReferencesSoft(arraysByPath, contractsByName);
  if (refIssues.length > 0) {
    return { ok: false, issues: refIssues };
  }

  const cycleIssue = detectCyclesSoft(arraysByPath);
  if (cycleIssue !== undefined) {
    return { ok: false, issues: [cycleIssue] };
  }

  const cache = new Map<string, ResolvedBundleLeaf[]>();
  const resolved = resolveBundleTree(
    effectiveBundles,
    [],
    arraysByPath,
    contractsByName,
    cache,
  );
  if (Array.isArray(resolved)) {
    return { ok: false, issues: [{ kind: "bundle_root_must_be_object" }] };
  }

  const collisionIssues = assertBundleRootKeysSoft(
    resolved,
    collectReservedCradleKeys(plans),
  );
  if (collisionIssues.length > 0) {
    return { ok: false, issues: collisionIssues };
  }

  return { ok: true, tree: resolved, arraysByPath };
};

export const buildBundleArraysInsight = (
  arraysByPath: Map<string, RawBundleArray>,
  plans: readonly ResolvedContractRegistration[],
): IocBundleArrayInsight[] => {
  const contractsByName = new Map<string, ResolvedContractRegistration>(
    plans.map((plan) => [plan.contractName, plan]),
  );
  const cache = new Map<string, ResolvedBundleLeaf[]>();
  const paths = Array.from(arraysByPath.keys()).sort((a, b) =>
    a.localeCompare(b),
  );
  return paths.map((p) => ({
    bundlePath: p,
    declaredMembers: [...(arraysByPath.get(p) ?? [])].map((item) =>
      typeof item === "string" ? item : { $bundleRef: item.$bundleRef },
    ),
    expandedMembers: resolveBundleArray(
      p,
      arraysByPath,
      contractsByName,
      cache,
    ),
  }));
};

export const buildBundlePlan = (
  bundles: unknown,
  plans: readonly ResolvedContractRegistration[],
  discovery?: BundleDiscoveryBuildContext,
): BundlePlanResult | undefined => {
  if (bundles === undefined) {
    return undefined;
  }

  const result = runBundlePlan(bundles, plans, discovery);
  if (!result.ok) {
    throw new Error(formatBundlePlanIssues(result.issues));
  }

  const arraysInsight = buildBundleArraysInsight(result.arraysByPath, plans);
  return { tree: result.tree, arraysInsight };
};

export type BundlePlanAnalysis =
  | {
      ok: true;
      tree: ResolvedBundleTree | undefined;
      arraysInsight: IocBundleArrayInsight[];
    }
  | {
      ok: false;
      tree: undefined;
      arraysInsight: [];
      issues: readonly BundlePlanIssue[];
    };

export const analyzeBundlePlan = (
  bundles: unknown,
  plans: readonly ResolvedContractRegistration[],
  discovery?: BundleDiscoveryBuildContext,
): BundlePlanAnalysis => {
  if (bundles === undefined) {
    return { ok: true, tree: undefined, arraysInsight: [] };
  }

  const result = runBundlePlan(bundles, plans, discovery);
  if (!result.ok) {
    return {
      ok: false,
      tree: undefined,
      arraysInsight: [],
      issues: result.issues,
    };
  }

  const arraysInsight = buildBundleArraysInsight(result.arraysByPath, plans);
  return {
    ok: true,
    tree: result.tree,
    arraysInsight,
  };
};
