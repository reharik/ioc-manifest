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
};

/** One contract row for `kind: "object"` groups; manifest object keys are `contractKey`. */
export type ContractDefaultGroupMember = {
  contractKey: string;
  contractName: string;
  registrationKey: string;
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
  return checker.getDeclaredTypeOfSymbol(sym);
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
): AssignableImplementationMember[] => {
  const members: AssignableImplementationMember[] = [];
  for (const plan of plans) {
    const contractType = getContractDeclaredType(
      checker,
      program,
      generatedDir,
      scanDirs,
      plan,
    );
    if (contractType === undefined) {
      continue;
    }
    if (!checker.isTypeAssignableTo(contractType, baseType)) {
      continue;
    }
    for (const impl of plan.implementations) {
      if (filterImpl !== undefined && !filterImpl(plan, impl)) {
        continue;
      }
      members.push({
        contractName: plan.contractName,
        registrationKey: impl.registrationKey,
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
): ContractDefaultGroupMember[] => {
  const members: ContractDefaultGroupMember[] = [];
  for (const plan of plans) {
    const contractType = getContractDeclaredType(
      checker,
      program,
      generatedDir,
      scanDirs,
      plan,
    );
    if (contractType === undefined) {
      continue;
    }
    if (!checker.isTypeAssignableTo(contractType, baseType)) {
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
    members.push({
      contractKey: plan.contractKey,
      contractName: plan.contractName,
      registrationKey: defaultImpl.registrationKey,
    });
  }
  members.sort((a, b) => a.contractKey.localeCompare(b.contractKey));
  return members;
};
