/**
 * @fileoverview Parses a generated `ioc-manifest.ts` SOURCE file into the manifest structure it
 * describes, without importing it.
 *
 * ### Why parsing is the only option
 *
 * A generated manifest is TypeScript. Importing it works only under a TS-capable loader, which the
 * `ioc` CLI is not: a consumer running `ioc inspect` through `bin/ioc.cjs` gets plain `node`, and
 * plain `node` answers a `.ts` import with `Unknown file extension ".ts"`. Every other reader of a
 * generated manifest in this codebase already knows that — `loadComposedManifestSupply`,
 * `loadComposedManifestOpenerKeys`, the contract and group loaders, and `ioc validate` all parse.
 * This module is where that discipline lives, so those readers and `ioc inspect` cannot drift: the
 * manifest is parsed once, here, and each caller projects the fields it needs out of the result.
 *
 * ### What is and is not recoverable
 *
 * Everything a manifest states as a literal comes back verbatim — that is the whole of `contracts`,
 * `scopeRoots`, and the group roots. `moduleImports` does NOT: its elements are live module
 * namespace objects, which exist only once something has actually imported the modules. Nothing
 * that reads a manifest as source has ever needed them (`moduleIndex` indexes an array only the
 * runtime materialises), so they are deliberately not reconstructed rather than faked.
 *
 * ### Recovery, not rejection
 *
 * A field the manifest omits is filled from what the surrounding structure already says — an
 * implementation's `contractName` from its contract key, its `implementationName` from its own key,
 * a missing `lifetime` from the generator's own default. The one hard gate is identity: an
 * implementation with no `registrationKey`, `exportName`, or `modulePath` is not a unit anyone can
 * say anything true about, so it is dropped. That is the same gate the composed-supply loader has
 * always applied, kept here now that it reads through this parser.
 */
import ts from "typescript";
import {
  IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS,
  IOC_MANIFEST_FEATURES_EXPORT_NAME,
  type IocContractManifest,
  type IocGroupKind,
  type IocGroupLeafManifest,
  type IocGroupNodeManifest,
  type IocGroupRootManifest,
  type IocGroupsManifest,
  type IocImplementationLifetime,
  type IocScopeRootsManifest,
  type IocUnitKind,
  type ModuleFactoryManifestMetadata,
  type ScopeRootVariantManifestMetadata,
} from "../core/manifest.js";

/** Lifetime the generator writes when a registration states none. Mirrors `DEFAULT_LIFETIME`. */
const FALLBACK_LIFETIME: IocImplementationLifetime = "singleton";

/**
 * `moduleIndex` for a unit whose manifest omits it.
 *
 * Negative on purpose: `moduleImports` is not reconstructed by a source parse (see the file
 * overview), so any index into it is meaningless here, and a value that cannot be mistaken for a
 * real index is safer than a plausible `0`.
 */
const UNKNOWN_MODULE_INDEX = -1;

export const unwrapObjectLiteral = (
  expr: ts.Expression,
): ts.ObjectLiteralExpression | undefined => {
  if (ts.isObjectLiteralExpression(expr)) {
    return expr;
  }
  if (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
    return unwrapObjectLiteral(expr.expression);
  }
  return undefined;
};

export const unwrapArrayLiteral = (
  expr: ts.Expression,
): ts.ArrayLiteralExpression | undefined => {
  if (ts.isArrayLiteralExpression(expr)) {
    return expr;
  }
  if (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
    return unwrapArrayLiteral(expr.expression);
  }
  return undefined;
};

const readPropertyName = (name: ts.PropertyName): string | undefined =>
  ts.isIdentifier(name) ||
  ts.isStringLiteral(name) ||
  ts.isNoSubstitutionTemplateLiteral(name)
    ? name.text
    : undefined;

export const readString = (node: ts.Expression): string | undefined =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;

export const readStringArray = (node: ts.Expression): string[] | undefined => {
  const array = unwrapArrayLiteral(node);
  if (array === undefined) {
    return undefined;
  }
  const out: string[] = [];
  for (const element of array.elements) {
    const text = readString(element);
    if (text !== undefined) {
      out.push(text);
    }
  }
  return out;
};

const readNumber = (node: ts.Expression): number | undefined =>
  ts.isNumericLiteral(node) ? Number(node.text) : undefined;

/** Property assignments of an object literal, by name. Non-assignments (spreads) are skipped. */
export const propertiesOf = (
  obj: ts.ObjectLiteralExpression,
): Map<string, ts.Expression> => {
  const out = new Map<string, ts.Expression>();
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      continue;
    }
    const name = readPropertyName(prop.name);
    if (name !== undefined) {
      out.set(name, prop.initializer);
    }
  }
  return out;
};

const readValue = (
  props: ReadonlyMap<string, ts.Expression>,
  name: string,
): string | undefined => {
  const node = props.get(name);
  return node === undefined ? undefined : readString(node);
};

const isTrue = (
  props: ReadonlyMap<string, ts.Expression>,
  name: string,
): boolean => props.get(name)?.kind === ts.SyntaxKind.TrueKeyword;

const isLifetime = (value: string): value is IocImplementationLifetime =>
  value === "singleton" || value === "scoped" || value === "transient";

const readUnitKind = (
  props: ReadonlyMap<string, ts.Expression>,
): IocUnitKind | undefined => {
  const kind = readValue(props, "kind");
  return kind === "class" || kind === "factory" ? kind : undefined;
};

/** The `iocManifest` object literal of a generated manifest source, if it has one. */
const findIocManifestObject = (
  sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression | undefined => {
  let found: ts.ObjectLiteralExpression | undefined;

  const visit = (node: ts.Node): void => {
    if (found !== undefined) {
      return;
    }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === "iocManifest" &&
          decl.initializer !== undefined
        ) {
          found = unwrapObjectLiteral(decl.initializer);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
};

/** The feature list a manifest declares through its {@link IOC_MANIFEST_FEATURES_EXPORT_NAME} sibling export. */
const findDeclaredFeatures = (
  sourceFile: ts.SourceFile,
): readonly string[] | undefined => {
  let found: readonly string[] | undefined;

  const visit = (node: ts.Node): void => {
    if (found !== undefined) {
      return;
    }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === IOC_MANIFEST_FEATURES_EXPORT_NAME &&
          decl.initializer !== undefined
        ) {
          found = readStringArray(decl.initializer);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
};

const parseImplementationMetadata = (
  contractName: string,
  implementationKey: string,
  meta: ts.ObjectLiteralExpression,
): ModuleFactoryManifestMetadata | undefined => {
  const props = propertiesOf(meta);

  const registrationKey = readValue(props, "registrationKey");
  const exportName = readValue(props, "exportName");
  const modulePath = readValue(props, "modulePath");
  if (
    registrationKey === undefined ||
    exportName === undefined ||
    modulePath === undefined
  ) {
    return undefined;
  }

  const lifetimeText = readValue(props, "lifetime");
  const unitKind = readUnitKind(props);
  const discoveredBy = readValue(props, "discoveredBy");
  const accessKey = readValue(props, "accessKey");
  const group = readValue(props, "group");
  const moduleIndexNode = props.get("moduleIndex");
  const dependencyContractNamesNode = props.get("dependencyContractNames");
  const dependencyKeysNode = props.get("dependencyKeys");
  const configOverridesNode = props.get("configOverridesApplied");

  return {
    ...(unitKind !== undefined && unitKind !== "factory"
      ? { kind: unitKind }
      : {}),
    exportName,
    registrationKey,
    modulePath,
    relImport: readValue(props, "relImport") ?? "",
    contractName: readValue(props, "contractName") ?? contractName,
    implementationName:
      readValue(props, "implementationName") ?? implementationKey,
    lifetime:
      lifetimeText !== undefined && isLifetime(lifetimeText)
        ? lifetimeText
        : FALLBACK_LIFETIME,
    moduleIndex:
      (moduleIndexNode !== undefined ? readNumber(moduleIndexNode) : undefined) ??
      UNKNOWN_MODULE_INDEX,
    ...(group !== undefined ? { group } : {}),
    ...(isTrue(props, "default") ? { default: true as const } : {}),
    ...(discoveredBy === "naming" || discoveredBy === "implements"
      ? { discoveredBy }
      : {}),
    ...(configOverridesNode !== undefined
      ? {
          configOverridesApplied: (readStringArray(configOverridesNode) ??
            []) as ModuleFactoryManifestMetadata["configOverridesApplied"],
        }
      : {}),
    ...(dependencyContractNamesNode !== undefined
      ? {
          dependencyContractNames:
            readStringArray(dependencyContractNamesNode) ?? [],
        }
      : {}),
    ...(dependencyKeysNode !== undefined
      ? { dependencyKeys: readStringArray(dependencyKeysNode) ?? [] }
      : {}),
    ...(accessKey !== undefined ? { accessKey } : {}),
  };
};

const parseContracts = (
  node: ts.Expression,
): IocContractManifest | undefined => {
  const contracts = unwrapObjectLiteral(node);
  if (contracts === undefined) {
    return undefined;
  }

  const out: IocContractManifest = {};
  for (const [contractName, implsNode] of propertiesOf(contracts)) {
    const impls = unwrapObjectLiteral(implsNode);
    if (impls === undefined) {
      continue;
    }
    const byImplName: Record<string, ModuleFactoryManifestMetadata> = {};
    for (const [implementationKey, metaNode] of propertiesOf(impls)) {
      const meta = unwrapObjectLiteral(metaNode);
      if (meta === undefined) {
        continue;
      }
      const parsed = parseImplementationMetadata(
        contractName,
        implementationKey,
        meta,
      );
      if (parsed !== undefined) {
        byImplName[implementationKey] = parsed;
      }
    }
    out[contractName] = byImplName;
  }
  return out;
};

const parseScopeRootVariant = (
  contractName: string,
  variantKeyName: string,
  meta: ts.ObjectLiteralExpression,
): ScopeRootVariantManifestMetadata | undefined => {
  const props = propertiesOf(meta);

  const exportName = readValue(props, "exportName");
  const openerKey = readValue(props, "openerKey");
  const modulePath = readValue(props, "modulePath");
  if (
    exportName === undefined ||
    openerKey === undefined ||
    modulePath === undefined
  ) {
    return undefined;
  }

  const unitKind = readUnitKind(props);
  const lbvKeysNode = props.get("lbvKeys");
  const moduleIndexNode = props.get("moduleIndex");

  return {
    ...(unitKind !== undefined && unitKind !== "factory"
      ? { kind: unitKind }
      : {}),
    exportName,
    openerKey,
    variantKey: readValue(props, "variantKey") ?? variantKeyName,
    contractName: readValue(props, "contractName") ?? contractName,
    variantName: readValue(props, "variantName") ?? variantKeyName,
    modulePath,
    relImport: readValue(props, "relImport") ?? "",
    lbvKeys:
      (lbvKeysNode !== undefined ? readStringArray(lbvKeysNode) : undefined) ??
      [],
    moduleIndex:
      (moduleIndexNode !== undefined ? readNumber(moduleIndexNode) : undefined) ??
      UNKNOWN_MODULE_INDEX,
  };
};

const parseScopeRoots = (
  node: ts.Expression,
): IocScopeRootsManifest | undefined => {
  const roots = unwrapObjectLiteral(node);
  if (roots === undefined) {
    return undefined;
  }

  const out: IocScopeRootsManifest = {};
  for (const [contractName, variantsNode] of propertiesOf(roots)) {
    const variants = unwrapObjectLiteral(variantsNode);
    if (variants === undefined) {
      continue;
    }
    const byVariant: Record<string, ScopeRootVariantManifestMetadata> = {};
    for (const [variantKeyName, metaNode] of propertiesOf(variants)) {
      const meta = unwrapObjectLiteral(metaNode);
      if (meta === undefined) {
        continue;
      }
      const parsed = parseScopeRootVariant(contractName, variantKeyName, meta);
      if (parsed !== undefined) {
        byVariant[variantKeyName] = parsed;
      }
    }
    out[contractName] = byVariant;
  }
  return out;
};

const parseGroupLeaf = (
  node: ts.Expression,
): IocGroupLeafManifest | undefined => {
  const leaf = unwrapObjectLiteral(node);
  if (leaf === undefined) {
    return undefined;
  }
  const props = propertiesOf(leaf);
  const contractName = readValue(props, "contractName");
  const registrationKey = readValue(props, "registrationKey");
  if (contractName === undefined || registrationKey === undefined) {
    return undefined;
  }
  const typeArgument = readValue(props, "typeArgument");
  return {
    contractName,
    registrationKey,
    ...(typeArgument !== undefined ? { typeArgument } : {}),
  };
};

const parseGroupMembers = (
  node: ts.Expression,
): IocGroupNodeManifest | undefined => {
  const array = unwrapArrayLiteral(node);
  if (array !== undefined) {
    return array.elements
      .map(parseGroupLeaf)
      .filter((leaf): leaf is IocGroupLeafManifest => leaf !== undefined);
  }

  const obj = unwrapObjectLiteral(node);
  if (obj === undefined) {
    return undefined;
  }
  const out: Record<string, IocGroupLeafManifest> = {};
  for (const [contractKey, leafNode] of propertiesOf(obj)) {
    const leaf = parseGroupLeaf(leafNode);
    if (leaf !== undefined) {
      out[contractKey] = leaf;
    }
  }
  return out;
};

const parseGroupRoot = (
  node: ts.Expression,
): IocGroupRootManifest | undefined => {
  const root = unwrapObjectLiteral(node);
  if (root === undefined) {
    return undefined;
  }
  const props = propertiesOf(root);

  const kindText = readValue(props, "kind");
  const kind: IocGroupKind | undefined =
    kindText === "collection" || kindText === "object" ? kindText : undefined;
  const baseType = readValue(props, "baseType");
  const membersNode = props.get("members");
  const members =
    membersNode === undefined ? undefined : parseGroupMembers(membersNode);

  if (kind === undefined || baseType === undefined || members === undefined) {
    return undefined;
  }

  const baseTypeArg = readValue(props, "baseTypeArg");
  return {
    kind,
    baseType,
    baseTypeId: readValue(props, "baseTypeId") ?? "",
    ...(baseTypeArg !== undefined ? { baseTypeArg } : {}),
    members,
  };
};

/**
 * A generated manifest's contents, as its source states them.
 *
 * `moduleImports` is absent by design — see the file overview.
 */
export type ParsedGeneratedManifest = {
  /** The literal the manifest states, or its source text when it is not a numeric literal. */
  readonly manifestSchemaVersion: unknown;
  readonly contracts: IocContractManifest;
  /** Absent when the manifest declares no `scopeRoots` property (pre-opener manifests). */
  readonly scopeRoots: IocScopeRootsManifest | undefined;
  /** Top-level non-fixed keys, per the fixed-key rule. */
  readonly groupRoots: IocGroupsManifest;
  /** The `IOC_MANIFEST_FEATURES` sibling export, or `undefined` when the manifest declares none. */
  readonly declaredFeatures: readonly string[] | undefined;
};

/**
 * Parses one generated manifest source.
 *
 * Throws when the file holds no `iocManifest` object literal — the one shape every reader depends
 * on. Everything below that is recovered rather than rejected (see the file overview).
 */
export const parseGeneratedManifestSource = (
  content: string,
  manifestPath: string,
): ParsedGeneratedManifest => {
  const sourceFile = ts.createSourceFile(
    manifestPath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  // Syntax first. `ts.createSourceFile` recovers from broken input rather than refusing it, so a
  // truncated or corrupted manifest still yields a walkable tree — one holding whatever survived
  // the damage. Reading that tree would report a manifest with, say, no contracts at all, which is
  // indistinguishable from a package that genuinely registers nothing. A file that does not parse
  // is not a manifest, and saying so is the only answer that cannot mislead.
  const parseErrors = (
    sourceFile as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] }
  ).parseDiagnostics;
  if (parseErrors !== undefined && parseErrors.length > 0) {
    throw new Error(
      `[ioc] generated manifest at ${JSON.stringify(manifestPath)} is not valid TypeScript: ` +
        parseErrors
          .slice(0, 3)
          .map((diagnostic) =>
            ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
          )
          .join("; "),
    );
  }

  const manifestObject = findIocManifestObject(sourceFile);
  if (manifestObject === undefined) {
    throw new Error(
      `[ioc] generated manifest at ${JSON.stringify(manifestPath)} does not export iocManifest`,
    );
  }

  let manifestSchemaVersion: unknown;
  let contracts: IocContractManifest = {};
  let scopeRoots: IocScopeRootsManifest | undefined;
  const groupRoots: IocGroupsManifest = {};

  for (const [key, value] of propertiesOf(manifestObject)) {
    if (key === "manifestSchemaVersion") {
      manifestSchemaVersion = ts.isNumericLiteral(value)
        ? Number(value.text)
        : value.getText(sourceFile);
      continue;
    }

    if (key === "contracts") {
      contracts = parseContracts(value) ?? {};
      continue;
    }

    if (key === "scopeRoots") {
      scopeRoots = parseScopeRoots(value);
      continue;
    }

    if (IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS.has(key)) {
      // `moduleImports` lands here and is deliberately not reconstructed.
      continue;
    }

    const groupRoot = parseGroupRoot(value);
    if (groupRoot !== undefined) {
      groupRoots[key] = groupRoot;
    }
  }

  return {
    manifestSchemaVersion,
    contracts,
    scopeRoots,
    groupRoots,
    declaredFeatures: findDeclaredFeatures(sourceFile),
  };
};
