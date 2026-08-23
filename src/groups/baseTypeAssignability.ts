import path from "node:path";
import ts from "typescript";
import { resolveContractTypeSourceFile } from "../generator/contractTypeSourceFile.js";
import type { ResolvedScanDir } from "../generator/manifestPaths.js";
import type { ResolvedContractRegistration } from "../generator/resolveRegistrationPlan.js";

export type BaseTypeResolution =
  | { ok: true; type: ts.Type }
  | { ok: false; message: string };

export type AssignableImplementationMember = {
  contractName: string;
  registrationKey: string;
  /** Live type this member binds to the generic base's first type parameter (for the gen-time gate). */
  typeArgument?: ts.Type;
};

/**
 * Why a candidate did not become a group member. Every member is a branch the membership pass
 * already takes — recording is a side effect of the existing walk, never a second analysis.
 */
export type GroupMembershipRejectionReason =
  | NominalAssignabilityRejectionReason
  /** The contract's declared type could not be loaded from the program, so it was never compared. */
  | "contract_type_unresolved";

/** One considered-and-rejected candidate, recorded for the inspection report only. */
export type GroupMembershipRejection = {
  contractName: string;
  reason: GroupMembershipRejectionReason;
  /** Set for implementation-level rejections; absent when the whole contract was rejected. */
  registrationKey?: string;
  /**
   * Whether the candidate has the base's SHAPE despite declaring no heritage to it — recorded only
   * when the sink asks for it, so it is `undefined` on every codegen-time rejection.
   *
   * This is the difference between the one rejection a reader wants to see and the eighty-four they
   * do not. Membership is nominal, so a contract that structurally satisfies the base and simply
   * never wrote `extends` is a near-miss: someone meant it to be a member, or will. A contract with
   * nothing in common with the base was never a candidate in any meaningful sense, and saying so
   * once per group per contract is what turned a real consumer's report into two thousand lines.
   *
   * Recording it changes NO verdict. Nominal assignability decided membership before this is
   * computed, and it is computed only for candidates that decision already rejected.
   */
  structurallyAssignable?: boolean;
};

/**
 * Where considered-and-rejected candidates are recorded, and how much is recorded about them.
 *
 * Codegen supplies no sink at all (it has no report to build). `ioc inspect --discovery` supplies
 * one asking for shape analysis, which costs one structural assignability check per rejected
 * candidate per group — paid by a command whose whole job is the report, and by nothing else.
 */
export type GroupRejectionSink = {
  readonly rejections: GroupMembershipRejection[];
  /** Record {@link GroupMembershipRejection.structurallyAssignable} on nominal rejections. */
  readonly recordStructuralShape?: boolean;
};

/** One sentence per rejection reason: what the check saw, and what would change the verdict. */
export const IOC_GROUP_REJECTION_GLOSS = {
  base_type_not_named:
    "the group's base type has no named symbol, so no contract can declare heritage to it",
  contract_type_not_named:
    "the contract's declared type has no named symbol (an anonymous or union type), so heritage cannot be traced from it",
  nominal_heritage_not_declared:
    "the contract declares no `extends` heritage to the group's base type; membership is nominal, so matching the base's shape is not enough",
  contract_type_unresolved:
    "the contract's declared type could not be loaded from the TypeScript program, so it was never compared to the base",
} as const satisfies Record<GroupMembershipRejectionReason, string>;

/**
 * Records one rejection, adding the shape verdict when the sink asked for it.
 *
 * Only `nominal_heritage_not_declared` gets a shape verdict: the other reasons are failures to
 * RESOLVE a type, so there is no candidate type to compare shapes with in the first place.
 */
const recordRejection = (
  sink: GroupRejectionSink | undefined,
  rejection: GroupMembershipRejection,
  shape: { checker: ts.TypeChecker; candidate: ts.Type; base: ts.Type } | undefined,
): void => {
  if (sink === undefined) {
    return;
  }
  if (
    sink.recordStructuralShape !== true ||
    shape === undefined ||
    rejection.reason !== "nominal_heritage_not_declared"
  ) {
    sink.rejections.push(rejection);
    return;
  }
  sink.rejections.push({
    ...rejection,
    structurallyAssignable: shape.checker.isTypeAssignableTo(
      shape.candidate,
      shape.base,
    ),
  });
};

export const glossForGroupRejection = (
  reason: GroupMembershipRejectionReason,
): string => IOC_GROUP_REJECTION_GLOSS[reason];

/** One contract row for `kind: "object"` groups; manifest object keys are `contractKey`. */
export type ContractDefaultGroupMember = {
  contractKey: string;
  contractName: string;
  registrationKey: string;
  /** Live type this member binds to the generic base's first type parameter (for the gen-time gate). */
  typeArgument?: ts.Type;
};

const getTopLevelTypeDeclaration = (
  sourceFile: ts.SourceFile,
  typeName: string,
): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined => {
  for (const stmt of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === typeName) {
      if (stmt.parent === sourceFile) {
        return stmt;
      }
    }
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === typeName) {
      if (stmt.parent === sourceFile) {
        return stmt;
      }
    }
  }
  return undefined;
};

export const getContractDeclaredType = (
  checker: ts.TypeChecker,
  program: ts.Program,
  generatedDir: string,
  scanDirs: readonly ResolvedScanDir[],
  plan: ResolvedContractRegistration,
): ts.Type | undefined => {
  const sourceFile = resolveContractTypeSourceFile(
    program,
    generatedDir,
    plan.contractTypeRelImport,
    scanDirs,
    plan.contractName,
  );
  if (sourceFile === undefined) {
    return undefined;
  }
  const decl = getTopLevelTypeDeclaration(sourceFile, plan.contractName);
  if (decl === undefined) {
    return undefined;
  }
  const sym = checker.getSymbolAtLocation(decl.name);
  if (sym === undefined) {
    return undefined;
  }
  const declared = checker.getDeclaredTypeOfSymbol(sym);
  // Strip `null` / `undefined` for callers that need the non-nullish declared shape. Nominal
  // group membership uses getContractDeclaredTypeRaw so union aliases do not confer heritage.
  return checker.getNonNullableType(declared);
};

/**
 * Resolve an unqualified interface/type-alias name across non–node_modules program sources.
 * Multiple declarations in different files are rejected as ambiguous.
 */
export const resolveDeclaredBaseType = (
  program: ts.Program,
  checker: ts.TypeChecker,
  typeName: string,
): BaseTypeResolution => {
  const declarationFiles = new Set<string>();
  let loneType: ts.Type | undefined;

  for (const sf of program.getSourceFiles()) {
    if (sf.fileName.includes(`${path.sep}node_modules${path.sep}`)) {
      continue;
    }
    const decl = getTopLevelTypeDeclaration(sf, typeName);
    if (decl === undefined) {
      continue;
    }
    declarationFiles.add(path.normalize(sf.fileName));
    const sym = checker.getSymbolAtLocation(decl.name);
    if (sym === undefined) {
      continue;
    }
    const t = checker.getDeclaredTypeOfSymbol(sym);
    loneType = t;
  }

  if (declarationFiles.size === 0) {
    return {
      ok: false,
      message: `no interface or type alias named ${JSON.stringify(typeName)} found in the TypeScript program (excluding node_modules)`,
    };
  }
  if (declarationFiles.size > 1) {
    const listed = [...declarationFiles].sort((a, b) => a.localeCompare(b));
    return {
      ok: false,
      message: `ambiguous base type ${JSON.stringify(typeName)}: declared in multiple files: ${listed.map((f) => JSON.stringify(f)).join(", ")}. Use a unique name or consolidate declarations.`,
    };
  }
  if (loneType === undefined) {
    return { ok: false, message: "internal error resolving base type" };
  }
  return { ok: true, type: loneType };
};

const getNamedSymbolForType = (type: ts.Type): ts.Symbol | undefined => {
  const sym = type.aliasSymbol ?? type.getSymbol();
  if (sym === undefined) {
    return undefined;
  }
  if (sym.flags & ts.SymbolFlags.Transient) {
    return undefined;
  }
  return sym;
};

const resolveCanonicalSymbol = (
  checker: ts.TypeChecker,
  sym: ts.Symbol,
): ts.Symbol => {
  let resolved = sym;
  while ((resolved.flags & ts.SymbolFlags.Alias) !== 0) {
    resolved = checker.getAliasedSymbol(resolved);
  }
  return resolved;
};

const typeNodeDeclaresNominalHeritageToBase = (
  checker: ts.TypeChecker,
  typeNode: ts.TypeNode,
  baseSym: ts.Symbol,
  visited: Set<ts.Symbol>,
): boolean => {
  if (ts.isIntersectionTypeNode(typeNode)) {
    for (const part of typeNode.types) {
      if (
        typeNodeDeclaresNominalHeritageToBase(checker, part, baseSym, visited)
      ) {
        return true;
      }
    }
    return false;
  }

  if (ts.isTypeReferenceNode(typeNode)) {
    const heritageSym = checker.getSymbolAtLocation(typeNode.typeName);
    if (heritageSym === undefined) {
      return false;
    }
    return symbolDeclaresNominalHeritageToBase(
      checker,
      heritageSym,
      baseSym,
      visited,
    );
  }

  return false;
};

const symbolDeclaresNominalHeritageToBase = (
  checker: ts.TypeChecker,
  candidateSym: ts.Symbol,
  baseSym: ts.Symbol,
  visited: Set<ts.Symbol>,
): boolean => {
  const canonicalCandidate = resolveCanonicalSymbol(checker, candidateSym);
  const canonicalBase = resolveCanonicalSymbol(checker, baseSym);
  if (canonicalCandidate === canonicalBase) {
    return true;
  }
  if (visited.has(canonicalCandidate)) {
    return false;
  }
  visited.add(canonicalCandidate);

  for (const decl of canonicalCandidate.declarations ?? []) {
    if (ts.isInterfaceDeclaration(decl)) {
      for (const clause of decl.heritageClauses ?? []) {
        for (const heritageType of clause.types) {
          const heritageSym = checker.getSymbolAtLocation(
            heritageType.expression,
          );
          if (heritageSym === undefined) {
            continue;
          }
          const canonicalHeritage = resolveCanonicalSymbol(
            checker,
            heritageSym,
          );
          if (canonicalHeritage === canonicalBase) {
            return true;
          }
          if (
            symbolDeclaresNominalHeritageToBase(
              checker,
              canonicalHeritage,
              canonicalBase,
              visited,
            )
          ) {
            return true;
          }
        }
      }
      continue;
    }

    if (ts.isTypeAliasDeclaration(decl)) {
      if (
        typeNodeDeclaresNominalHeritageToBase(
          checker,
          decl.type,
          baseSym,
          visited,
        )
      ) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Why a candidate contract type is not nominally assignable to a group base. One member per branch
 * the walk below actually takes — no reason exists here that the check cannot distinguish.
 */
export type NominalAssignabilityRejectionReason =
  /** The group base type carries no named symbol, so nothing can declare heritage to it. */
  | "base_type_not_named"
  /**
   * The candidate's declared type collapsed to a type with no named symbol — an anonymous or
   * transient type, e.g. a type alias whose right-hand side is a union. There is no symbol to start
   * a heritage walk from.
   */
  | "contract_type_not_named"
  /** The walk ran to completion and found no declared `extends` / intersection path to the base. */
  | "nominal_heritage_not_declared";

export type NominalAssignabilityAnalysis =
  | { assignable: true }
  | { assignable: false; reason: NominalAssignabilityRejectionReason };

/**
 * {@link isNominallyAssignable} with the failing branch reported. Single pass — the caller gets the
 * verdict and the reason from the same walk, never from a second check.
 */
export const analyzeNominalAssignability = (
  checker: ts.TypeChecker,
  candidate: ts.Type,
  base: ts.Type,
): NominalAssignabilityAnalysis => {
  const baseSym = getNamedSymbolForType(base);
  if (baseSym === undefined) {
    return { assignable: false, reason: "base_type_not_named" };
  }
  const candidateSym = getNamedSymbolForType(candidate);
  if (candidateSym === undefined) {
    return { assignable: false, reason: "contract_type_not_named" };
  }
  const canonicalBase = resolveCanonicalSymbol(checker, baseSym);
  const canonicalCandidate = resolveCanonicalSymbol(checker, candidateSym);
  // Alias collapse onto the base symbol is an ACCEPTANCE branch, not a rejection: a contract whose
  // alias resolves to the base itself is a member of its own group.
  if (canonicalCandidate === canonicalBase) {
    return { assignable: true };
  }
  const visited = new Set<ts.Symbol>();
  return symbolDeclaresNominalHeritageToBase(
    checker,
    canonicalCandidate,
    canonicalBase,
    visited,
  )
    ? { assignable: true }
    : { assignable: false, reason: "nominal_heritage_not_declared" };
};

/**
 * Whether `candidate` declares (transitively) nominal heritage to `base` via `extends` or
 * type-alias intersection — not structural shape matching.
 */
export const isNominallyAssignable = (
  checker: ts.TypeChecker,
  candidate: ts.Type,
  base: ts.Type,
): boolean => analyzeNominalAssignability(checker, candidate, base).assignable;

/** Declared type-parameter counts for a group's base type, read from its declaration. */
export type BaseTypeParameterInfo = {
  /** Total declared type parameters. */
  arity: number;
  /** Type parameters with no default (must be supplied). */
  requiredCount: number;
};

const isTypeParameterizedDeclaration = (
  decl: ts.Declaration,
): decl is
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration
  | ts.ClassDeclaration =>
  ts.isInterfaceDeclaration(decl) ||
  ts.isTypeAliasDeclaration(decl) ||
  ts.isClassDeclaration(decl);

/**
 * Reads the base type's declared type parameters. `arity` is the total; `requiredCount` counts
 * parameters without a default (a defaulted param may be omitted by a group, a required one may not).
 */
export const getBaseTypeParameterInfo = (
  checker: ts.TypeChecker,
  baseType: ts.Type,
): BaseTypeParameterInfo => {
  const sym = getNamedSymbolForType(baseType);
  const canonical =
    sym !== undefined ? resolveCanonicalSymbol(checker, sym) : undefined;
  const decl = canonical?.declarations?.find(isTypeParameterizedDeclaration);
  const typeParameters = decl?.typeParameters ?? [];
  return {
    arity: typeParameters.length,
    requiredCount: typeParameters.filter((tp) => tp.default === undefined)
      .length,
  };
};

const isTypeReference = (type: ts.Type): type is ts.TypeReference =>
  (type.flags & ts.TypeFlags.Object) !== 0 &&
  ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) !== 0;

const findBaseTypeArgument = (
  checker: ts.TypeChecker,
  type: ts.Type,
  canonicalBase: ts.Symbol,
  visited: Set<ts.Type>,
): ts.Type | undefined => {
  if (visited.has(type)) {
    return undefined;
  }
  visited.add(type);

  const sym = type.getSymbol();
  if (sym !== undefined) {
    if (resolveCanonicalSymbol(checker, sym) === canonicalBase) {
      if (isTypeReference(type)) {
        const args = checker.getTypeArguments(type);
        return args.length > 0 ? args[0] : undefined;
      }
      return undefined;
    }
  }

  if (type.isClassOrInterface()) {
    for (const base of checker.getBaseTypes(type)) {
      const found = findBaseTypeArgument(checker, base, canonicalBase, visited);
      if (found !== undefined) {
        return found;
      }
    }
  }

  return undefined;
};

/**
 * The type a member contract binds to the generic `baseType`'s first type parameter, e.g. for
 * `type AlbumStrategy = Strategy<"album.shared">` (or `interface X extends Strategy<...>`), returns
 * the `"album.shared"` type. Walks the member's own reference and its transitive base types.
 * Returns undefined when the base is not generic or the member does not instantiate it directly.
 */
export const extractMemberBaseTypeArgument = (
  checker: ts.TypeChecker,
  memberContractType: ts.Type,
  baseType: ts.Type,
): ts.Type | undefined => {
  const baseSym = getNamedSymbolForType(baseType);
  if (baseSym === undefined) {
    return undefined;
  }
  const canonicalBase = resolveCanonicalSymbol(checker, baseSym);
  return findBaseTypeArgument(
    checker,
    memberContractType,
    canonicalBase,
    new Set(),
  );
};

/**
 * The minimum a caller must know about a contract to look its declared type back up: the name, and
 * the type-only import specifier discovery recorded for it.
 *
 * Narrower than {@link ResolvedContractRegistration} on purpose. Group membership has to be
 * answerable BEFORE the registration plan exists — the plan's own election depends on it — so the
 * membership walk must not require a plan.
 */
export type ContractTypeRef = {
  readonly contractName: string;
  readonly contractTypeRelImport: string;
};

/**
 * A contract's declared type exactly as the nominal membership walk sees it: no non-nullable
 * stripping, because a union alias must NOT confer heritage. Exported so the early grouped-contract
 * index and the authoritative membership pass read the contract through one function; two ways of
 * loading a contract type is two ways to disagree about who is in a group.
 */
export const getContractDeclaredTypeForMembership = (
  checker: ts.TypeChecker,
  program: ts.Program,
  generatedDir: string,
  scanDirs: readonly ResolvedScanDir[],
  contract: ContractTypeRef,
): ts.Type | undefined => {
  const sourceFile = resolveContractTypeSourceFile(
    program,
    generatedDir,
    contract.contractTypeRelImport,
    scanDirs,
    contract.contractName,
  );
  if (sourceFile === undefined) {
    return undefined;
  }
  const decl = getTopLevelTypeDeclaration(sourceFile, contract.contractName);
  if (decl === undefined) {
    return undefined;
  }
  const sym = checker.getSymbolAtLocation(decl.name);
  if (sym === undefined) {
    return undefined;
  }
  return checker.getDeclaredTypeOfSymbol(sym);
};

/** Back-compat alias for the in-file call sites, which pass a full plan. */
const getContractDeclaredTypeRaw = getContractDeclaredTypeForMembership;

/**
 * Whether `candidateType` is structurally assignable to a top-level type named `baseTypeName`
 * in the program (excluding node_modules). Used for contract-shape validation, not group membership.
 */
export const isTypeAssignableToNamedBase = (
  checker: ts.TypeChecker,
  program: ts.Program,
  candidateType: ts.Type,
  baseTypeName: string,
): { ok: true } | { ok: false; message: string } => {
  const resolved = resolveDeclaredBaseType(program, checker, baseTypeName);
  if (!resolved.ok) {
    return resolved;
  }
  if (!checker.isTypeAssignableTo(candidateType, resolved.type)) {
    return { ok: false, message: "not assignable" };
  }
  return { ok: true };
};

/*
 * RETIRED: `shouldIncludeImplInCollectionGroup`.
 *
 * It dropped a non-default implementation registered at the contract's default-slot key, so the
 * group would not carry a second "default slot" entry alongside the named ones. Grouped ⇒
 * group-only removed the premise: a grouped contract HAS no default slot, so an implementation
 * whose registration key happens to equal the camel-cased contract name is an ordinary member key
 * with nothing to duplicate. Keeping the filter would have silently dropped a legitimate member
 * from its own group — the one outcome a group must never produce quietly.
 */

/**
 * All implementations belonging to contracts assignable to `baseType` (per declared contract type).
 * Skips contracts whose declared type cannot be loaded from the program.
 *
 * EVERY implementation of a member contract is a member. There is no per-implementation filter any
 * more (see the retirement note above): a grouped contract has no default slot, so no registration
 * key of one can collide with a slot, and a group that silently omitted one of its own members
 * would be the worst possible failure — a collection that looks complete and is not.
 *
 * @param sink - When set, every considered-and-rejected candidate is appended to it. Recording
 * only: membership semantics are identical whether or not the sink is supplied.
 */
export const collectImplementationMembersAssignableToBase = (
  checker: ts.TypeChecker,
  program: ts.Program,
  generatedDir: string,
  scanDirs: readonly ResolvedScanDir[],
  plans: readonly ResolvedContractRegistration[],
  baseType: ts.Type,
  sink?: GroupRejectionSink,
): AssignableImplementationMember[] => {
  const members: AssignableImplementationMember[] = [];
  for (const plan of plans) {
    const contractType = getContractDeclaredTypeRaw(
      checker,
      program,
      generatedDir,
      scanDirs,
      plan,
    );
    if (contractType === undefined) {
      recordRejection(
        sink,
        {
          contractName: plan.contractName,
          reason: "contract_type_unresolved",
        },
        undefined,
      );
      continue;
    }
    const nominal = analyzeNominalAssignability(
      checker,
      contractType,
      baseType,
    );
    if (!nominal.assignable) {
      recordRejection(
        sink,
        { contractName: plan.contractName, reason: nominal.reason },
        { checker, candidate: contractType, base: baseType },
      );
      continue;
    }
    const typeArgument = extractMemberBaseTypeArgument(
      checker,
      contractType,
      baseType,
    );
    for (const impl of plan.implementations) {
      members.push({
        contractName: plan.contractName,
        registrationKey: impl.registrationKey,
        ...(typeArgument !== undefined ? { typeArgument } : {}),
      });
    }
  }
  members.sort((a, b) => a.registrationKey.localeCompare(b.registrationKey));
  return members;
};

/**
 * For each contract whose declared type is assignable to `baseType`, one member using the
 * contract's default implementation registration key. Manifest keys are the contract key
 * (camel-cased contract name), not implementation registration keys.
 */
export const collectContractDefaultMembersAssignableToBase = (
  checker: ts.TypeChecker,
  program: ts.Program,
  generatedDir: string,
  scanDirs: readonly ResolvedScanDir[],
  plans: readonly ResolvedContractRegistration[],
  baseType: ts.Type,
  sink?: GroupRejectionSink,
): ContractDefaultGroupMember[] => {
  const members: ContractDefaultGroupMember[] = [];
  for (const plan of plans) {
    const contractType = getContractDeclaredTypeRaw(
      checker,
      program,
      generatedDir,
      scanDirs,
      plan,
    );
    if (contractType === undefined) {
      recordRejection(
        sink,
        {
          contractName: plan.contractName,
          reason: "contract_type_unresolved",
        },
        undefined,
      );
      continue;
    }
    const nominal = analyzeNominalAssignability(
      checker,
      contractType,
      baseType,
    );
    if (!nominal.assignable) {
      recordRejection(
        sink,
        { contractName: plan.contractName, reason: nominal.reason },
        { checker, candidate: contractType, base: baseType },
      );
      continue;
    }
    const defaultImpl = plan.implementations.find(
      (impl) => impl.implementationName === plan.defaultImplementationName,
    );
    if (defaultImpl === undefined) {
      throw new Error(
        `[ioc-config] Contract ${JSON.stringify(plan.contractName)} has defaultImplementationName ${JSON.stringify(plan.defaultImplementationName)} but no matching implementation row (internal registration plan inconsistency).`,
      );
    }
    const typeArgument = extractMemberBaseTypeArgument(
      checker,
      contractType,
      baseType,
    );
    members.push({
      contractKey: plan.contractKey,
      contractName: plan.contractName,
      registrationKey: defaultImpl.registrationKey,
      ...(typeArgument !== undefined ? { typeArgument } : {}),
    });
  }
  members.sort((a, b) => a.contractKey.localeCompare(b.contractKey));
  return members;
};
