/**
 * @fileoverview Ruling 2: **lifetime is a property of the group, declared on the base.**
 *
 * A group is a family. Its members are interchangeable at the consumption site — a collection group
 * hands them out anonymously, a record group hands them out by contract name — and a family whose
 * members disagree about lifetime is not interchangeable at all: resolving the group would mix a
 * singleton and a per-scope instance in one array, and the consumer has no way to know or care
 * which is which. So the lifetime is declared once, on the base, and every member ranks it.
 *
 * The corollary is what this file enforces. A member declaring its own lifetime — through a marker
 * on its own heritage, or through a per-implementation `lifetime` override in `ioc.config` — is
 * asserting authority over a property of the family it does not own. It is not a conflict to
 * resolve by precedence; it is a statement the member is not entitled to make, so it is an error
 * rather than a losing bid.
 *
 * ### The 2.x tombstone
 *
 * The rule this replaces was never *most-restrictive-member-wins*. What 2.0.0 actually shipped is
 * recorded in the v3 audit as "group roots are transient wrappers; members keep their own
 * lifetimes" — no aggregation at all, each member ranked independently, and a group could hand out
 * a mixed-lifetime collection with nothing said about it. Most-restrictive-wins would have been
 * inference compensating for undeclared groups: with no place to say what a family's lifetime was,
 * the tool would have had to guess one from the members. Declaring it on the base removes the
 * question rather than answering it, and supersedes both.
 */
import path from "node:path";
import {
  isIocImplementationOverride,
  type IocConfig,
  type IocLifetime,
  type IocOverride,
} from "../config/iocConfig.js";
import {
  getContractDeclaredTypeForMembership,
  type ContractTypeRef,
} from "../groups/baseTypeAssignability.js";
import { resolveGroupBaseType } from "../groups/groupBaseType.js";
import {
  memberDeclaredMarkers,
  type GroupedContractIndex,
} from "../groups/groupedContracts.js";
import type { GroupDiscoveryBuildContext } from "../groups/resolveGroupPlan.js";
import { resolveLifetimeMarkerTypes } from "./resolveLifetimeMarkers.js";
import type { DiscoveredFactory } from "./types.js";

/** Every way a member can claim authority over its family's lifetime. */
export type GroupLifetimeFindingCode =
  /** A `lifetimeMarkers` interface on the member contract's own heritage, absent from the base. */
  | "group-lifetime-on-member"
  /** `registrations[Member][impl].lifetime` in `ioc.config` for a grouped member. */
  | "group-lifetime-config-override";

export type GroupLifetimeFinding = {
  code: GroupLifetimeFindingCode;
  contractName: string;
  message: string;
};

const declareOnBase = (contractName: string, baseType: string): string =>
  `lifetime is a property of the group; declare the marker on the base ${JSON.stringify(baseType)} (member ${JSON.stringify(contractName)} may not carry its own)`;

export const formatGroupLifetimeErrors = (
  findings: readonly GroupLifetimeFinding[],
): string =>
  [
    `[ioc] ${findings.length} grouped member${findings.length === 1 ? "" : "s"} declare${findings.length === 1 ? "s" : ""} a lifetime. A group is a family whose members are handed out interchangeably, so the family ranks one lifetime and the base is where it is declared:`,
    ...findings.map((finding) => finding.message),
  ].join("\n");

export type ValidateGroupLifetimeContext = {
  /** Contracts discovery found, with the specifier their declared type is reachable through. */
  contracts: readonly ContractTypeRef[];
  grouped: GroupedContractIndex;
  config: IocConfig | undefined;
  discovery: GroupDiscoveryBuildContext | undefined;
  projectRoot: string;
  /** Accepted factories, so a config override can be reported against a real implementation. */
  factories: readonly DiscoveredFactory[];
};

const perImplementationOverrides = (
  config: IocConfig | undefined,
  contractName: string,
): [string, IocOverride][] => {
  const entry = config?.registrations?.[contractName];
  if (entry === undefined) {
    return [];
  }
  const out: [string, IocOverride][] = [];
  for (const [implementationName, value] of Object.entries(entry)) {
    if (
      implementationName === "$contract" ||
      !isIocImplementationOverride(value as IocOverride)
    ) {
      continue;
    }
    out.push([implementationName, value as IocOverride]);
  }
  return out;
};

/**
 * Collects every member-level lifetime declaration on a grouped contract.
 *
 * Returns findings rather than throwing so one run reports every offender — the offender-bucket
 * shape the rest of the generator uses.
 */
export const collectGroupLifetimeFindings = (
  ctx: ValidateGroupLifetimeContext,
): GroupLifetimeFinding[] => {
  const findings: GroupLifetimeFinding[] = [];
  if (ctx.grouped.byContractName.size === 0) {
    return findings;
  }

  // Config overrides need no program: the declaration is in `ioc.config` and the membership verdict
  // is already in hand, so this half runs even when marker resolution is unavailable.
  for (const [contractName, membership] of ctx.grouped.byContractName) {
    for (const [implementationName, override] of perImplementationOverrides(
      ctx.config,
      contractName,
    )) {
      if (override.lifetime === undefined) {
        continue;
      }
      findings.push({
        code: "group-lifetime-config-override",
        contractName,
        message: `  - [group-lifetime-config-override] registrations[${JSON.stringify(contractName)}][${JSON.stringify(implementationName)}].lifetime is set to ${JSON.stringify(override.lifetime)}, but ${JSON.stringify(contractName)} is a member of group ${JSON.stringify(membership.groupName)}: ${declareOnBase(contractName, membership.baseType)}. Set the lifetime for the whole family by putting a lifetimeMarkers interface on ${JSON.stringify(membership.baseType)}.`,
      });
    }
  }

  const markerConfig = ctx.config?.lifetimeMarkers;
  if (
    ctx.discovery === undefined ||
    markerConfig === undefined ||
    Object.keys(markerConfig).length === 0
  ) {
    return findings;
  }

  const checker = ctx.discovery.program.getTypeChecker();
  const markers = resolveLifetimeMarkerTypes(ctx.discovery.program, markerConfig);
  const contractByName = new Map<string, ContractTypeRef>();
  for (const contract of ctx.contracts) {
    if (!contractByName.has(contract.contractName)) {
      contractByName.set(contract.contractName, contract);
    }
  }

  for (const [contractName, membership] of ctx.grouped.byContractName) {
    // The base contract itself carrying the marker IS the sanctioned declaration.
    if (membership.isBase) {
      continue;
    }
    const contract = contractByName.get(contractName);
    if (contract === undefined) {
      continue;
    }
    const base = resolveGroupBaseType(checker, ctx.discovery, membership.baseType);
    if (!base.ok) {
      continue;
    }
    const contractType = getContractDeclaredTypeForMembership(
      checker,
      ctx.discovery.program,
      ctx.discovery.generatedDir,
      ctx.discovery.scanDirs,
      contract,
    );
    if (contractType === undefined) {
      continue;
    }

    const declared = memberDeclaredMarkers(
      checker,
      contractType,
      base.type,
      markers,
    );
    for (const marker of declared) {
      findings.push({
        code: "group-lifetime-on-member",
        contractName,
        message: `  - [group-lifetime-on-member] Contract ${JSON.stringify(contractName)}${memberLocation(ctx, contractName)} declares lifetime marker ${JSON.stringify(marker.name)} (${marker.lifetime}), but it is a member of group ${JSON.stringify(membership.groupName)}: ${declareOnBase(contractName, membership.baseType)}. Move \`extends ${marker.name}\` from ${JSON.stringify(contractName)} to ${JSON.stringify(membership.baseType)}, or take ${JSON.stringify(contractName)} out of the group.`,
      });
    }
  }

  return findings;
};

/** " in services/Foo.ts" for the first implementation of the contract, or "" when unknown. */
const memberLocation = (
  ctx: ValidateGroupLifetimeContext,
  contractName: string,
): string => {
  const factory = ctx.factories.find((f) => f.contractName === contractName);
  if (factory === undefined) {
    return "";
  }
  const rel = path
    .relative(ctx.projectRoot, path.join(ctx.projectRoot, factory.modulePath))
    .replace(/\\/g, "/");
  return ` (implemented in ${rel})`;
};

/**
 * Generation-time entry point: one aggregated throw carrying every member-level lifetime
 * declaration in the package.
 */
export const validateGroupLifetimeAtCodegen = (
  ctx: ValidateGroupLifetimeContext,
): void => {
  const findings = collectGroupLifetimeFindings(ctx);
  if (findings.length > 0) {
    throw new Error(formatGroupLifetimeErrors(findings));
  }
};

/** Re-exported for the config-override half, which reads a plain lifetime value. */
export type { IocLifetime };
