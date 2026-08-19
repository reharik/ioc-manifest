import path from "node:path";
import ts from "typescript";
import { resolveContractTypeSourceFile } from "../generator/contractTypeSourceFile.js";
import type { ResolvedScanDir } from "../generator/manifestPaths.js";
import type {
  ResolvedContractRegistration,
  ResolvedImplementationEntry,
} from "../generator/resolveRegistrationPlan.js";

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
  | "contract_type_unresolved"
  /**
   * Collection groups only: the contract passed, but this implementation is a non-default one
   * sitting on the contract's default-slot key, which {@link shouldIncludeImplInCollectionGroup}
   * drops so the group does not carry a second "default slot" entry.
   */
  | "non_default_impl_at_contract_slot";

/** One considered-and-rejected candidate, recorded for the inspection report only. */
export type GroupMembershipRejection = {
  contractName: string;
  reason: GroupMembershipRejectionReason;
  /** Set for implementation-level rejections; absent when the whole contract was rejected. */
  registrationKey?: string;
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
  non_default_impl_at_contract_slot:
    "the implementation is a non-default one registered at the contract's default-slot key, which would duplicate default-slot semantics in the group",
} as const satisfies Record<GroupMembershipRejectionReason, string>;

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

const getContractDeclaredTypeRaw = (
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
  return checker.getDeclaredTypeOfSymbol(sym);
};

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

/**
 * Whether an implementation should appear in a **collection** group.
 *
 * Skips non-default implementations registered at the contract default slot key (`contractKey`).
 * Those registrations occupy the canonical contract name as a key while another implementation is
 * the selected default; including them would duplicate “default slot” semantics alongside named keys.
 */
export const shouldIncludeImplInCollectionGroup = (
  plan: ResolvedContractRegistration,
  impl: ResolvedImplementationEntry,
): boolean =>
  impl.registrationKey !== plan.contractKey ||
  impl.implementationName === plan.defaultImplementationName;

/**
 * All implementations belonging to contracts assignable to `baseType` (per declared contract type).
 * Skips contracts whose declared type cannot be loaded from the program.
 *
 * @param filterImpl - When set, only implementations for which this returns true are included.
 * @param rejections - When set, every considered-and-rejected candidate is appended here. Recording
 * only: membership semantics are identical whether or not the sink is supplied.
 */
export const collectImplementationMembersAssignableToBase = (
  checker: ts.TypeChecker,
  program: ts.Program,
  generatedDir: string,
  scanDirs: readonly ResolvedScanDir[],
  plans: readonly ResolvedContractRegistration[],
  baseType: ts.Type,
  filterImpl?: (
    plan: ResolvedContractRegistration,
    impl: ResolvedImplementationEntry,
  ) => boolean,
  rejections?: GroupMembershipRejection[],
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
      rejections?.push({
        contractName: plan.contractName,
        reason: "contract_type_unresolved",
      });
      continue;
    }
    const nominal = analyzeNominalAssignability(
      checker,
      contractType,
      baseType,
    );
    if (!nominal.assignable) {
      rejections?.push({
        contractName: plan.contractName,
        reason: nominal.reason,
      });
      continue;
    }
    const typeArgument = extractMemberBaseTypeArgument(
      checker,
      contractType,
      baseType,
    );
    for (const impl of plan.implementations) {
      if (filterImpl !== undefined && !filterImpl(plan, impl)) {
        rejections?.push({
          contractName: plan.contractName,
          registrationKey: impl.registrationKey,
          reason: "non_default_impl_at_contract_slot",
        });
        continue;
      }
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
  rejections?: GroupMembershipRejection[],
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
      rejections?.push({
        contractName: plan.contractName,
        reason: "contract_type_unresolved",
      });
      continue;
    }
    const nominal = analyzeNominalAssignability(
      checker,
      contractType,
      baseType,
    );
    if (!nominal.assignable) {
      rejections?.push({
        contractName: plan.contractName,
        reason: nominal.reason,
      });
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
