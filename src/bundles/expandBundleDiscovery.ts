import path from "node:path";
import ts from "typescript";
import { resolveContractTypeSourceFile } from "../generator/contractTypeSourceFile.js";
import {
  isBundleDiscoverLeaf,
  parseDiscoverBaseInterface,
} from "./bundleDiscovery.types.js";
import type { ResolvedContractRegistration } from "../generator/resolveRegistrationPlan.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export type BundleDiscoveryExpansionIssue = {
  path: string;
  message: string;
};

/** Path key aligned with other bundle plan issues: `services.read`, not `bundles.services.read`. */
const bundleIssuePath = (segments: readonly string[]): string =>
  segments.length === 0 ? "" : segments.join(".");

/**
 * Walk raw config to see if expansion (TypeScript program) is required.
 */
export const bundleTreeContainsDiscover = (node: unknown): boolean => {
  if (isBundleDiscoverLeaf(node)) {
    return true;
  }
  if (Array.isArray(node)) {
    return false;
  }
  if (!isRecord(node)) {
    return false;
  }
  return Object.values(node).some((child) => bundleTreeContainsDiscover(child));
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

const getContractDeclaredType = (
  checker: ts.TypeChecker,
  program: ts.Program,
  generatedDir: string,
  plan: ResolvedContractRegistration,
): ts.Type | undefined => {
  const sourceFile = resolveContractTypeSourceFile(
    program,
    generatedDir,
    plan.contractTypeRelImport,
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

type BaseResolution =
  | { ok: true; type: ts.Type }
  | { ok: false; message: string };

/**
 * Resolve an unqualified interface/type-alias name across non–node_modules program sources.
 * Multiple declarations in different files are rejected as ambiguous.
 */
const resolveBaseInterfaceType = (
  program: ts.Program,
  checker: ts.TypeChecker,
  interfaceName: string,
): BaseResolution => {
  const declarationFiles = new Set<string>();
  let loneType: ts.Type | undefined;

  for (const sf of program.getSourceFiles()) {
    if (sf.fileName.includes(`${path.sep}node_modules${path.sep}`)) {
      continue;
    }
    const decl = getTopLevelTypeDeclaration(sf, interfaceName);
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
      message: `no interface or type alias named ${JSON.stringify(interfaceName)} found in the TypeScript program (excluding node_modules)`,
    };
  }
  if (declarationFiles.size > 1) {
    const listed = [...declarationFiles].sort((a, b) => a.localeCompare(b));
    return {
      ok: false,
      message: `ambiguous base interface ${JSON.stringify(interfaceName)}: declared in multiple files: ${listed.map((f) => JSON.stringify(f)).join(", ")}. Use a unique name or consolidate declarations.`,
    };
  }
  if (loneType === undefined) {
    return { ok: false, message: "internal error resolving base interface type" };
  }
  return { ok: true, type: loneType };
};

const expandNode = (
  node: unknown,
  pathSegments: string[],
  checker: ts.TypeChecker,
  program: ts.Program,
  plans: readonly ResolvedContractRegistration[],
  generatedDir: string,
): { value: unknown; issues: BundleDiscoveryExpansionIssue[] } => {
  const issues: BundleDiscoveryExpansionIssue[] = [];
  const pathKey = bundleIssuePath(pathSegments);

  if (Array.isArray(node)) {
    return { value: node, issues };
  }

  if (isBundleDiscoverLeaf(node)) {
    const parsed = parseDiscoverBaseInterface(node.$discover);
    if (!parsed.ok) {
      issues.push({ path: pathKey, message: parsed.message });
      return { value: node, issues };
    }

    const base = resolveBaseInterfaceType(program, checker, parsed.baseInterface);
    if (!base.ok) {
      issues.push({ path: pathKey, message: base.message });
      return { value: node, issues };
    }

    const matchedNames: string[] = [];
    for (const plan of plans) {
      const contractType = getContractDeclaredType(
        checker,
        program,
        generatedDir,
        plan,
      );
      /**
       * $discover walks every registered contract (not dependency subgraph). If we cannot load the
       * contract's declared type from the TS program (e.g. third-party .d.ts layout, missing file in
       * program roots), skip that contract instead of failing the whole bundle — we cannot prove
       * assignability either way.
       */
      if (contractType === undefined) {
        continue;
      }
      if (checker.isTypeAssignableTo(contractType, base.type)) {
        matchedNames.push(plan.contractName);
      }
    }

    matchedNames.sort((a, b) => a.localeCompare(b));
    return { value: matchedNames, issues };
  }

  if (!isRecord(node)) {
    issues.push({
      path: pathKey,
      message: "expected an object, array, or { $discover: ... } leaf",
    });
    return { value: node, issues };
  }

  const keys = Object.keys(node);
  if (keys.includes("$discover")) {
    issues.push({
      path: pathKey,
      message:
        'invalid bundle node: "$discover" must be the only key on a discovery leaf (no sibling properties)',
    });
    return { value: node, issues };
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(node)) {
    const childResult = expandNode(
      child,
      [...pathSegments, key],
      checker,
      program,
      plans,
      generatedDir,
    );
    issues.push(...childResult.issues);
    out[key] = childResult.value;
  }
  return { value: out, issues };
};

export const expandBundleDiscoveryInTree = (
  bundles: unknown,
  checker: ts.TypeChecker,
  program: ts.Program,
  plans: readonly ResolvedContractRegistration[],
  generatedDir: string,
):
  | { ok: true; bundles: unknown }
  | { ok: false; issues: readonly BundleDiscoveryExpansionIssue[] } => {
  if (!bundleTreeContainsDiscover(bundles)) {
    return { ok: true, bundles };
  }
  const { value, issues } = expandNode(
    bundles,
    [],
    checker,
    program,
    plans,
    generatedDir,
  );
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, bundles: value };
};
