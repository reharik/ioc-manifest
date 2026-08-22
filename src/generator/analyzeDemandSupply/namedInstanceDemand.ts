/**
 * @fileoverview `Named<T>` — the declaration that a deps property demands one SPECIFIC
 * implementation — and the rule that decides, for every deps property, which of the five declared
 * things it is.
 *
 * ### The model this enforces
 *
 * A deps property is exactly one of:
 *
 * | written                                          | means                                  |
 * |--------------------------------------------------|----------------------------------------|
 * | contract key (`authMiddleware: AuthMiddleware`)   | the contract's elected default         |
 * | `Named<T>` impl key (`strict: Named<AuthMiddleware>`) | that specific implementation       |
 * | group key                                        | the group                              |
 * | opener key                                       | the scope opener                       |
 * | anything else                                    | an external (unregistered demand)      |
 *
 * Rows one and two used to be spelled identically, so which one a property meant was decided by
 * whether its NAME happened to be a registration key — a fact invisible at the site and liable to
 * change when someone renames a factory. `Named<T>` makes the second row say what it is, and that
 * in turn lets the bare spelling of it become a hard error instead of an accident that works.
 *
 * ### Where this sits in the claim chain
 *
 * Marker recognition runs **before** the generated-reference claim parsers
 * (`IocGeneratedCradle["k"]`, group aliases, opener aliases) and before anything is handed to the
 * checker. Two reasons:
 *
 * 1. The parsers and the marker answer different questions. A claim parser asks "which cradle key
 *    does this TYPE name?"; the marker asks "which of the five things is this PROPERTY?". Reading
 *    the property's kind first means a misplaced or wrong-arity marker is reported as itself,
 *    rather than falling through to a confusing unresolvable-type error from the checker.
 * 2. The two can never both hold, so no precedence is being invented. Every claim parser rejects a
 *    type reference carrying type arguments, and `Named<T>` always carries one — so a `Named<…>`
 *    property is never claimed, and a claimed property never carries the marker.
 *
 * A property a claim parser DOES claim is exempt from the marker requirement, including when its
 * name is an implementation key. `IocGeneratedCradle["s3Storage"]` is already an explicit,
 * enumerated statement of which cradle key is wanted — the ambiguity the marker exists to remove is
 * not present — so requiring a second declaration on top of it would be ceremony, not clarity.
 *
 * The precedence used by the SCOPE-ROOT walk (`classifyDemandedKey`: group → registration → access
 * key → declared group → lbv → external) is untouched by any of this. That walk consumes
 * `dependencyKeys`, which are binding-pattern names and carry no types at all, so the marker cannot
 * reach it; and a slot key sits where it always sat, after registrations, which is the same answer
 * either way for a key that is both.
 */
import path from "node:path";
import ts from "typescript";
import { resolveAnnotationContract } from "../discoverFactories/contractSite.js";
import { resolveDepsPropertyTypeNode } from "./resolveIocGeneratedCradleIndexedAccess.js";
import type { FactorySourceLocation } from "./types.js";

/** Written name of the named-instance marker exported by this package. */
export const NAMED_MARKER_NAME = "Named";

/** The form the marker must be written in, quoted verbatim by the wrong-arity error. */
export const NAMED_MARKER_FORM = `${NAMED_MARKER_NAME}<TContract>`;

/**
 * Every way a deps property can contradict the five-row model, as a stable code.
 *
 * Codes are printed in the aggregated error so a failure is greppable and so `docs/reference/errors.md`
 * has something to gloss. They are per-RULE, not per-property: one run reports every offender.
 */
export type NamedDemandFindingCode =
  /** A bare demand for an implementation registration key — the marker is missing. */
  | "named-marker-required"
  /** `Named<C>` where the implementation's declared contract is not `C`. */
  | "named-contract-mismatch"
  /** `Named<…>` on a contract slot key: the slot IS the elected default, not an implementation. */
  | "named-on-contract-key"
  /** `Named<…>` on a group root key. */
  | "named-on-group-key"
  /** `Named<…>` on a scope-root opener key. */
  | "named-on-opener-key"
  /** `Named<…>` on a key no implementation, local or composed, is registered under. */
  | "named-unknown-key"
  /** `Named` written with anything other than exactly one type argument. */
  | "named-wrong-arity"
  /**
   * A demand for an individual member of a configured GROUP — through any spelling.
   *
   * Grouped ⇒ group-only: a member is consumed through the group and through nothing else, so
   * `Named<MemberContract>`, `Named<GroupBase>` and the bare member-key demand all land here rather
   * than on the strict-identity or unknown-key texts. Those would misdirect: the problem is the
   * family, not which contract was named.
   */
  | "grouped-member-demand";

export type NamedDemandFinding = {
  code: NamedDemandFindingCode;
  /** The offending deps property name. */
  key: string;
  /** Single-line offender text, already carrying its code and location. */
  message: string;
};

/** A `Named<…>` reference at a deps property's written type node. */
type NamedMarker =
  | { kind: "none" }
  | { kind: "named"; contractSite: ts.TypeNode }
  | { kind: "wrong_arity"; typeArgumentCount: number };

/**
 * Reads `Named<…>` off a written type node.
 *
 * Recognition is by written name with no checker involvement — the same trade `Promise<T>` and
 * `ScopeRoot<TContract, TLbv>` already make, and for the same reason: identity in v3 is what the
 * author wrote. A locally-declared `Named` shadows the marker, and that is the accepted cost.
 *
 * Wrong arity is a hard finding rather than a silent skip, following the `scope_root_wrong_arity`
 * precedent: writing `Named` at all is an unambiguous attempt to declare a named-instance demand,
 * and this feature does not guess at what a missing or extra argument meant.
 */
export const readNamedMarker = (node: ts.TypeNode | undefined): NamedMarker => {
  if (
    node === undefined ||
    !ts.isTypeReferenceNode(node) ||
    !ts.isIdentifier(node.typeName) ||
    node.typeName.text !== NAMED_MARKER_NAME
  ) {
    return { kind: "none" };
  }

  const typeArguments = node.typeArguments ?? [];
  if (typeArguments.length !== 1) {
    return { kind: "wrong_arity", typeArgumentCount: typeArguments.length };
  }
  return { kind: "named", contractSite: typeArguments[0]! };
};

/**
 * The marker at a deps property, read through the same alias-following seam every claim parser
 * reads through — so `type LocalDep = Named<Storage>` used as a property type is the same
 * declaration as writing it inline.
 */
export const namedMarkerAtDepsProperty = (
  checker: ts.TypeChecker,
  typeNode: ts.TypeNode | undefined,
): NamedMarker =>
  readNamedMarker(resolveDepsPropertyTypeNode(typeNode, checker));

/** One registration a demand key may name, in the terms the rule needs. */
export type DemandableImplementation = {
  registrationKey: string;
  contractName: string;
  /** The composed package the implementation came from; absent for a local registration. */
  packageName?: string;
};

/**
 * A contract's group membership, as the demand rule needs to read it.
 *
 * Carried per CONTRACT, not per key, because all three illegal spellings are recognized from the
 * contract behind the property — the member's own contract for a member key, and the base for the
 * `Named<GroupBase>` spelling.
 */
export type DemandGroupMembership = {
  groupName: string;
  kind: "collection" | "object";
  baseType: string;
  /** Cradle key of the group root — what a legal demand names instead. */
  groupKey: string;
  /**
   * Record-kind groups expose members as properties of the group value. Naming one in the guidance
   * turns "use the group" from a rule into an instruction.
   */
  memberProperty?: string;
};

/**
 * Every name the container will answer to, split by which of the five rows it belongs to.
 *
 * Built once per generation run by {@link buildDemandKeyUniverse}; consulted per deps property.
 */
export type DemandKeyUniverse = {
  /** Implementation registration keys — local and composed — to their declared contract. */
  implementationsByKey: ReadonlyMap<string, DemandableImplementation>;
  /** Contract slot keys — local and composed — to the contract they are the elected default of. */
  contractNameBySlotKey: ReadonlyMap<string, string>;
  /** Contract name → its slot key, when it has one, for the two-spellings advice. */
  slotKeyByContractName: ReadonlyMap<string, string>;
  groupKeys: ReadonlySet<string>;
  openerKeys: ReadonlySet<string>;
  /**
   * Grouped contracts, by contract name. Consulted before every other row of the model: a grouped
   * contract has no slot key and its implementations claim no individual cradle keys, so any
   * property naming one is the grouped-member error rather than any of the five legal things.
   */
  groupMembershipByContractName: ReadonlyMap<string, DemandGroupMembership>;
  /**
   * The would-be contract key of each grouped contract — the name its slot WOULD have had.
   *
   * Not a key that exists; it is here so a demand for it is recognized as the group mistake it is
   * rather than falling silently through to `IocExternals`, where it would surface much later as an
   * unsatisfied external in another package's `ioc validate` run.
   */
  groupedContractNameByAbsentSlotKey: ReadonlyMap<string, string>;
};

export type BuildDemandKeyUniverseInput = {
  localImplementations: readonly DemandableImplementation[];
  composedImplementations?: readonly DemandableImplementation[];
  /** Local slots, from the registration plan. */
  localSlots?: readonly { accessKey: string; contractName: string }[];
  /** Composed slots: access key → the registration key it aliases. */
  composedSlots?: ReadonlyMap<string, string>;
  groupKeys?: Iterable<string>;
  openerKeys?: Iterable<string>;
  /** Group membership per contract name, from `groups/groupedContracts.ts`. */
  groupMemberships?: ReadonlyMap<string, DemandGroupMembership>;
  /** Would-be contract keys of grouped contracts — names their slot WOULD have had. */
  absentGroupedSlotKeys?: ReadonlyMap<string, string>;
};

/**
 * Assembles the universe. Local rows win over composed ones wherever both claim a name, which is
 * the same precedence the scope-root supply index and `registerIocFromManifest` apply: a local
 * registration is what discovery actually saw, and a genuine collision is composition's error.
 */
export const buildDemandKeyUniverse = (
  input: BuildDemandKeyUniverseInput,
): DemandKeyUniverse => {
  const implementationsByKey = new Map<string, DemandableImplementation>();
  for (const impl of input.localImplementations) {
    implementationsByKey.set(impl.registrationKey, impl);
  }
  for (const impl of input.composedImplementations ?? []) {
    if (!implementationsByKey.has(impl.registrationKey)) {
      implementationsByKey.set(impl.registrationKey, impl);
    }
  }

  const contractNameBySlotKey = new Map<string, string>();
  const slotKeyByContractName = new Map<string, string>();
  for (const slot of input.localSlots ?? []) {
    contractNameBySlotKey.set(slot.accessKey, slot.contractName);
    slotKeyByContractName.set(slot.contractName, slot.accessKey);
  }
  for (const [accessKey, registrationKey] of input.composedSlots ?? []) {
    if (contractNameBySlotKey.has(accessKey)) {
      continue;
    }
    const contractName =
      implementationsByKey.get(registrationKey)?.contractName;
    if (contractName === undefined) {
      continue;
    }
    contractNameBySlotKey.set(accessKey, contractName);
    if (!slotKeyByContractName.has(contractName)) {
      slotKeyByContractName.set(contractName, accessKey);
    }
  }

  return {
    implementationsByKey,
    contractNameBySlotKey,
    slotKeyByContractName,
    groupKeys: new Set(input.groupKeys ?? []),
    openerKeys: new Set(input.openerKeys ?? []),
    groupMembershipByContractName: input.groupMemberships ?? new Map(),
    groupedContractNameByAbsentSlotKey: input.absentGroupedSlotKeys ?? new Map(),
  };
};

/**
 * The three-beat guidance every grouped-member demand gets, whichever spelling produced it.
 *
 * 1. what to write instead — naming the group key, and the member property when the kind provides
 *    one;
 * 2. the lever, when keyed access to a member is genuinely what is wanted — the group's `kind` is
 *    the config knob, and a member that cannot live under either kind does not belong in the group;
 * 3. the pointer to the deferred design question, so a reader who has a legitimate need for both
 *    the family and one member knows it was considered rather than overlooked.
 */
const groupedMemberGuidance = (
  membership: DemandGroupMembership,
  demandedKey: string,
): string => {
  const consume =
    membership.kind === "object" && membership.memberProperty !== undefined
      ? `Consume it through the group: \`${membership.groupKey}: ${groupKeyToAliasName(membership.groupKey)}\`, then \`${membership.groupKey}.${membership.memberProperty}\`.`
      : `Consume it through the group: \`${membership.groupKey}: ${groupKeyToAliasName(membership.groupKey)}\` — a collection group's members are individually anonymous by declaration, so ${JSON.stringify(demandedKey)} names nothing.`;

  const lever =
    membership.kind === "object"
      ? `If you need keyed access to a different member, the group's \`kind\` is the lever — a record group already exposes every member as a property; a member that should not be reachable that way does not belong in groups.${membership.groupName}.`
      : `If you need keyed access to a member, the group's \`kind\` is the lever: flip groups.${membership.groupName}.kind to "object" so members are exposed as properties (record kind keys members by CONTRACT, so it fits a family of distinct contracts, not several implementations of one) — or the member does not belong in the group.`;

  return `${consume} ${lever} Consumer-divergent group consumption — one consumer wanting the family, another wanting one member — is a known, deliberately deferred design question; see "Consumer-divergent group consumption — considered, deferred" in docs/design/per-package-manifest.md.`;
};

/** `channels` → `Channels`, matching the emitted group alias. Local copy: no import cycle. */
const groupKeyToAliasName = (key: string): string =>
  key.length === 0 ? key : key.charAt(0).toUpperCase() + key.slice(1);

const formatLocation = (
  projectRoot: string,
  loc: FactorySourceLocation,
): string => {
  const abs = path.isAbsolute(loc.modulePath)
    ? loc.modulePath
    : path.join(projectRoot, loc.modulePath);
  return `${path.relative(projectRoot, abs).replace(/\\/g, "/")}:${loc.line}`;
};

const unitLabel = (loc: FactorySourceLocation): string =>
  loc.unitKind === "class" ? "Class" : "Factory";

const offenderPrefix = (
  code: NamedDemandFindingCode,
  projectRoot: string,
  loc: FactorySourceLocation,
  propertyName: string,
): string =>
  `  - [${code}] ${unitLabel(loc)} ${JSON.stringify(loc.exportName)} at ${formatLocation(projectRoot, loc)} property ${JSON.stringify(propertyName)}`;

/** The origin clause an error uses to say where an implementation lives. */
const implementationOrigin = (impl: DemandableImplementation): string =>
  impl.packageName === undefined
    ? "in this package"
    : `in composed package ${JSON.stringify(impl.packageName)}`;

/**
 * The sentence every `named-marker-required` offender ends with: both legal spellings, written out.
 *
 * When the contract has no elected default there is no slot key to offer, and saying so is the
 * point — the reader would otherwise try the contract key and find it does not exist.
 */
const twoSpellings = (
  impl: DemandableImplementation,
  universe: DemandKeyUniverse,
): string => {
  const slotKey = universe.slotKeyByContractName.get(impl.contractName);
  const named = `for this specific implementation, write \`${impl.registrationKey}: ${NAMED_MARKER_NAME}<${impl.contractName}>\``;
  if (slotKey === undefined) {
    return `Contract ${JSON.stringify(impl.contractName)} elects no default, so it has no contract key; ${named}.`;
  }
  return `For the elected default, demand the contract key \`${slotKey}: ${impl.contractName}\`; ${named}.`;
};

/**
 * The grouped-member finding for one property, or `undefined` when the property names nothing
 * grouped.
 *
 * Two ways in. The property names an implementation whose CONTRACT is grouped — that covers both
 * marker spellings and the bare demand, since all three name a member's registration key. Or the
 * property names a grouped contract's would-be slot key, which exists nowhere: the natural second
 * guess after learning members have no keys, and worth catching here rather than letting it drift
 * out as an unsatisfied external in someone else's validate run.
 */
const groupedMemberFinding = (
  projectRoot: string,
  loc: FactorySourceLocation,
  propertyName: string,
  universe: DemandKeyUniverse,
  markerPresent: boolean,
): NamedDemandFinding | undefined => {
  const impl = universe.implementationsByKey.get(propertyName);
  const viaImplementation =
    impl !== undefined
      ? universe.groupMembershipByContractName.get(impl.contractName)
      : undefined;

  if (viaImplementation !== undefined) {
    const spelling = markerPresent
      ? `carries \`${NAMED_MARKER_NAME}<…>\``
      : "demands it by name";
    return {
      code: "grouped-member-demand",
      key: propertyName,
      message: `${offenderPrefix("grouped-member-demand", projectRoot, loc, propertyName)} ${spelling}, but ${JSON.stringify(propertyName)} is an implementation of ${JSON.stringify(impl!.contractName)}, a member of group ${JSON.stringify(viaImplementation.groupName)}. A grouped contract is consumed through its group and through nothing else — it has no contract key and its implementations claim no individual cradle keys. ${groupedMemberGuidance(viaImplementation, propertyName)}`,
    };
  }

  const absentSlotContract =
    universe.groupedContractNameByAbsentSlotKey.get(propertyName);
  if (absentSlotContract !== undefined) {
    const membership =
      universe.groupMembershipByContractName.get(absentSlotContract);
    if (membership !== undefined) {
      return {
        code: "grouped-member-demand",
        key: propertyName,
        message: `${offenderPrefix("grouped-member-demand", projectRoot, loc, propertyName)} names the contract key ${JSON.stringify(propertyName)} of ${JSON.stringify(absentSlotContract)}, which is a member of group ${JSON.stringify(membership.groupName)} and therefore has no contract key — grouped contracts are consumed through the group and through nothing else. ${groupedMemberGuidance(membership, propertyName)}`,
      };
    }
  }

  return undefined;
};

export type CheckNamedDemandInput = {
  checker: ts.TypeChecker;
  projectRoot: string;
  loc: FactorySourceLocation;
  propertyName: string;
  /** The property's written type node, before any checker resolution. */
  typeNode: ts.TypeNode | undefined;
  /**
   * True when a generated-reference claim parser already claimed this property
   * (`IocGeneratedCradle["k"]`, a group alias, an opener alias). Such a property has already said
   * which cradle key it names and is exempt from the marker requirement.
   *
   * It is NOT exempt from the grouped-member rule, and the check is ordered accordingly. The marker
   * exemption is about ambiguity, which an explicit key spelling removes; the grouped rule is about
   * a key that does not exist, which no spelling can conjure — `IocGeneratedCradle["s3Storage"]`
   * for a grouped member indexes a property the emitted cradle does not carry.
   */
  claimedByGeneratedReference: boolean;
  universe: DemandKeyUniverse;
};

/**
 * Decides whether one deps property contradicts the five-row model.
 *
 * Returns the finding, or `undefined` when the property is one of the five legal things. Never
 * throws: the caller aggregates every offender in the package into a single error.
 */
export const checkNamedDemand = (
  input: CheckNamedDemandInput,
): NamedDemandFinding | undefined => {
  const {
    checker,
    projectRoot,
    loc,
    propertyName,
    typeNode,
    claimedByGeneratedReference,
    universe,
  } = input;

  const marker = namedMarkerAtDepsProperty(checker, typeNode);

  // GROUPED ⇒ GROUP-ONLY, checked before every other row of the model.
  //
  // All three illegal spellings are recognized from the PROPERTY NAME, not from the type argument:
  // `key: Named<MemberContract>`, `key: Named<GroupBase>` and the bare `key: MemberContract` are
  // one mistake wearing three faces, and the face does not change the fix. Recognizing them here
  // is what keeps `Named<GroupBase>` — the most idiomatic-looking of the three — off the
  // strict-identity error, which would tell the reader to name a different contract when no
  // contract choice is legal.
  const groupedFinding = groupedMemberFinding(
    projectRoot,
    loc,
    propertyName,
    universe,
    marker.kind !== "none",
  );
  if (groupedFinding !== undefined) {
    return groupedFinding;
  }

  if (marker.kind === "wrong_arity") {
    return {
      code: "named-wrong-arity",
      key: propertyName,
      message: `${offenderPrefix("named-wrong-arity", projectRoot, loc, propertyName)} writes \`${NAMED_MARKER_NAME}\` with ${marker.typeArgumentCount} type argument(s). The marker takes exactly one: write \`${NAMED_MARKER_FORM}\`.`,
    };
  }

  if (marker.kind === "none") {
    if (claimedByGeneratedReference) {
      return undefined;
    }
    // Row 1, 3, 4 and 5 all spell themselves without the marker. Only a name that IS an
    // implementation registration key — and is not simultaneously one of the other rows — is the
    // bare implementation demand the marker replaced.
    if (
      universe.contractNameBySlotKey.has(propertyName) ||
      universe.groupKeys.has(propertyName) ||
      universe.openerKeys.has(propertyName)
    ) {
      return undefined;
    }
    const impl = universe.implementationsByKey.get(propertyName);
    if (impl === undefined) {
      return undefined;
    }
    return {
      code: "named-marker-required",
      key: propertyName,
      message: `${offenderPrefix("named-marker-required", projectRoot, loc, propertyName)} is the registration key of implementation ${JSON.stringify(impl.registrationKey)} (contract ${JSON.stringify(impl.contractName)}, ${implementationOrigin(impl)}), demanded without saying so. ${twoSpellings(impl, universe)}`,
    };
  }

  // From here the marker is present, so the property claims to name an implementation.
  const slotContract = universe.contractNameBySlotKey.get(propertyName);
  if (slotContract !== undefined) {
    return {
      code: "named-on-contract-key",
      key: propertyName,
      message: `${offenderPrefix("named-on-contract-key", projectRoot, loc, propertyName)} carries \`${NAMED_MARKER_NAME}<…>\`, but ${JSON.stringify(propertyName)} is the contract key of ${JSON.stringify(slotContract)} — it names whichever implementation is elected as the default, not a specific one. Drop the marker to demand the elected default, or name an implementation's own registration key.`,
    };
  }
  if (universe.groupKeys.has(propertyName)) {
    return {
      code: "named-on-group-key",
      key: propertyName,
      message: `${offenderPrefix("named-on-group-key", projectRoot, loc, propertyName)} carries \`${NAMED_MARKER_NAME}<…>\`, but ${JSON.stringify(propertyName)} is a group root key — it resolves the whole group, not one implementation. Drop the marker, or demand a member's own registration key with \`${NAMED_MARKER_NAME}<…>\`.`,
    };
  }
  if (universe.openerKeys.has(propertyName)) {
    return {
      code: "named-on-opener-key",
      key: propertyName,
      message: `${offenderPrefix("named-on-opener-key", projectRoot, loc, propertyName)} carries \`${NAMED_MARKER_NAME}<…>\`, but ${JSON.stringify(propertyName)} is a scope-root opener key — an opener is emitted by generation, not registered by an implementation. Demand it by its emitted alias instead.`,
    };
  }

  const impl = universe.implementationsByKey.get(propertyName);
  if (impl === undefined) {
    return {
      code: "named-unknown-key",
      key: propertyName,
      message: `${offenderPrefix("named-unknown-key", projectRoot, loc, propertyName)} carries \`${NAMED_MARKER_NAME}<…>\`, but no implementation — local or composed — is registered under ${JSON.stringify(propertyName)}. \`${NAMED_MARKER_NAME}\` declares a demand for a specific registration; an unregistered key is an external and is demanded by its plain type.`,
    };
  }

  const resolution = resolveAnnotationContract(checker, marker.contractSite);
  const demandedContractName =
    resolution.kind === "resolved" ? resolution.contractName : undefined;

  if (demandedContractName === undefined) {
    return {
      code: "named-contract-mismatch",
      key: propertyName,
      message: `${offenderPrefix("named-contract-mismatch", projectRoot, loc, propertyName)} writes \`${NAMED_MARKER_NAME}<${marker.contractSite.getText()}>\`, whose type argument is not a named contract reference. Implementation ${JSON.stringify(impl.registrationKey)} declares contract ${JSON.stringify(impl.contractName)}; write \`${NAMED_MARKER_NAME}<${impl.contractName}>\`.`,
    };
  }

  // Strict identity, never assignability: `Named<C>` asserts that this implementation's DECLARED
  // contract is `C`. A supertype that the implementation happens to satisfy is a different
  // statement, and accepting it would make the annotation stop meaning what it says the moment the
  // implementation's own contract changed underneath it.
  if (demandedContractName !== impl.contractName) {
    return {
      code: "named-contract-mismatch",
      key: propertyName,
      message: `${offenderPrefix("named-contract-mismatch", projectRoot, loc, propertyName)} demands \`${NAMED_MARKER_NAME}<${demandedContractName}>\`, but implementation ${JSON.stringify(impl.registrationKey)} (${implementationOrigin(impl)}) declares contract ${JSON.stringify(impl.contractName)}. \`${NAMED_MARKER_NAME}\` matches the implementation's declared contract exactly — write \`${NAMED_MARKER_NAME}<${impl.contractName}>\`, or name an implementation of ${JSON.stringify(demandedContractName)}.`,
    };
  }

  return undefined;
};

/**
 * The aggregated error text for every offender in one run — the offender-bucket shape discovery and
 * scope-root verification already use, so a single run surfaces every failure instead of the first.
 */
export const formatNamedDemandErrors = (
  findings: readonly NamedDemandFinding[],
): string =>
  [
    findings.length === 1
      ? `[ioc] 1 deps property does not name one of the five things a dependency can be. A deps property names either a contract key (the contract's elected default), an implementation registration key marked \`${NAMED_MARKER_FORM}\`, a group root key, a scope-root opener key, or an external:`
      : `[ioc] ${findings.length} deps properties do not name one of the five things a dependency can be. A deps property names either a contract key (the contract's elected default), an implementation registration key marked \`${NAMED_MARKER_FORM}\`, a group root key, a scope-root opener key, or an external:`,
    ...findings.map((finding) => finding.message),
  ].join("\n");
