/**
 * @fileoverview Reads composed package manifests as SUPPLY for the scope-root subtree walk.
 *
 * The other composed loaders in this directory each answer one narrow question — which contract
 * names exist, which group roots exist, which opener keys are claimed. This one answers the
 * question a demand WALK asks: given a cradle key, what unit supplies it, and what does that unit
 * itself demand? A composing app cannot answer that from its own discovery, because the units live
 * in another package and were compiled by another run of the generator.
 *
 * What it reconstructs is precisely what `registerIocFromManifest` will register from the same
 * file — implementation keys, contract default-slot aliases, and group roots — so the walk's idea
 * of the container matches the container that will actually exist. It is read the way every other
 * composed loader reads: a fresh parse of the generated manifest SOURCE, never an import of it.
 *
 * ### Degraded mode
 *
 * `dependencyKeys` is a recent addition (see `ModuleFactoryManifestMetadata`). A manifest generated
 * before it exists carries no demand edges at all, and there is no way to recover them from here —
 * the sources are in another package and may not even be present. Such a package is reported by
 * name in {@link ComposedManifestSupply.packagesWithoutDependencyData} so its callers can say so
 * out loud rather than return a confident verdict over a subtree they could not see.
 */
import fs from "node:fs";
import ts from "typescript";
import {
  IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS,
  IOC_MANIFEST_FEATURES_EXPORT_NAME,
  type IocImplementationLifetime,
} from "../core/manifest.js";
import { contractNameToDefaultRegistrationKey } from "./naming.js";
import { resolvePackageExportPath } from "./resolveComposedPackageExport.js";

/**
 * One registration unit carried in by a composed package manifest.
 *
 * `modulePath` is PACKAGE-QUALIFIED (`@scope/lib/services/buildReader.ts`) rather than the raw
 * package-relative path the manifest stores. Unit identity across the whole generator is the pair
 * (modulePath, exportName), and two packages may perfectly well each hold a `buildReader.ts`; the
 * qualified form keeps that pair unique and doubles as the thing error messages should print.
 */
export type ComposedManifestUnit = {
  /** The composed package this unit came from, as written in `config.composedManifests`. */
  packageName: string;
  contractName: string;
  implementationName: string;
  registrationKey: string;
  exportName: string;
  /** Package-qualified module path — see the note above. */
  modulePath: string;
  lifetime: IocImplementationLifetime;
  /** True when the manifest marked this implementation the contract's default. */
  isDefault: boolean;
  /**
   * Cradle keys this unit demands, when the manifest carries them.
   *
   * `undefined` means "not known" and never "none": a unit whose manifest predates the field and a
   * unit that genuinely demands nothing are indistinguishable here, which is exactly why
   * {@link ComposedManifestSupply.packagesWithoutDependencyData} exists.
   */
  dependencyKeys?: readonly string[];
};

export type ComposedManifestSupply = {
  /** Every composed registration unit, in manifest order per package. */
  units: readonly ComposedManifestUnit[];
  /**
   * Contract default-slot aliases: access key → the registration key it resolves to.
   *
   * Mirrors `registerContractDefaultAliases` — the explicit `accessKey` when one implementation
   * carries it, otherwise the camel-cased contract name — so a demand written against the contract
   * key walks to the same unit the container will hand it.
   */
  accessKeys: ReadonlyMap<string, string>;
  /** Composed group roots: group key → member registration keys, in manifest order. */
  groupMembersByGroupKey: ReadonlyMap<string, readonly string[]>;
  /**
   * Composed packages whose manifest carries no dependency-key data.
   *
   * Sorted. Non-empty means some part of any subtree reaching those packages is unwalkable, which
   * callers must disclose rather than paper over.
   */
  packagesWithoutDependencyData: readonly string[];
};

export const EMPTY_COMPOSED_MANIFEST_SUPPLY: ComposedManifestSupply = {
  units: [],
  accessKeys: new Map(),
  groupMembersByGroupKey: new Map(),
  packagesWithoutDependencyData: [],
};

const unwrapObjectLiteral = (
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

const unwrapArrayLiteral = (
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

const readString = (node: ts.Expression): string | undefined =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;

const readStringArray = (node: ts.Expression): string[] | undefined => {
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

/** Property assignments of an object literal, by name. Non-assignments (spreads) are skipped. */
const propertiesOf = (
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

const isLifetime = (value: string): value is IocImplementationLifetime =>
  value === "singleton" || value === "scoped" || value === "transient";

/** Member registration keys of a group node, for both group kinds (array and object). */
const groupMemberKeys = (node: ts.Expression): string[] => {
  const leafKey = (leaf: ts.Expression): string | undefined => {
    const obj = unwrapObjectLiteral(leaf);
    if (obj === undefined) {
      return undefined;
    }
    const key = propertiesOf(obj).get("registrationKey");
    return key === undefined ? undefined : readString(key);
  };

  const array = unwrapArrayLiteral(node);
  if (array !== undefined) {
    return array.elements
      .map(leafKey)
      .filter((key): key is string => key !== undefined);
  }

  const obj = unwrapObjectLiteral(node);
  if (obj === undefined) {
    return [];
  }
  return [...propertiesOf(obj).values()]
    .map(leafKey)
    .filter((key): key is string => key !== undefined);
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

/** One package's contribution, before the per-package results are merged. */
export type ComposedManifestPackageSupply = {
  units: readonly ComposedManifestUnit[];
  accessKeys: ReadonlyMap<string, string>;
  groupMembersByGroupKey: ReadonlyMap<string, readonly string[]>;
  /** True when the manifest declares that it carries `dependencyKeys` in full. */
  carriesDependencyKeys: boolean;
};

/**
 * Parses one generated manifest source into walk-ready supply.
 *
 * Exported for its own tests and because it is the whole of the parsing logic; the loader below
 * only resolves paths and merges.
 */
export const parseComposedManifestSupplySource = (
  content: string,
  manifestPath: string,
  packageName: string,
): ComposedManifestPackageSupply => {
  const sourceFile = ts.createSourceFile(
    manifestPath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const manifestObject = findIocManifestObject(sourceFile);
  if (manifestObject === undefined) {
    throw new Error(
      `[ioc] composed package manifest at ${JSON.stringify(manifestPath)} does not export iocManifest`,
    );
  }

  const units: ComposedManifestUnit[] = [];
  const accessKeys = new Map<string, string>();
  const groupMembersByGroupKey = new Map<string, readonly string[]>();

  for (const [topKey, topValue] of propertiesOf(manifestObject)) {
    if (topKey === "contracts") {
      const contracts = unwrapObjectLiteral(topValue);
      if (contracts === undefined) {
        continue;
      }
      for (const [contractName, implsNode] of propertiesOf(contracts)) {
        const impls = unwrapObjectLiteral(implsNode);
        if (impls === undefined) {
          continue;
        }

        const contractUnits: ComposedManifestUnit[] = [];
        let explicitAccessKey: string | undefined;

        for (const [implementationName, metaNode] of propertiesOf(impls)) {
          const meta = unwrapObjectLiteral(metaNode);
          if (meta === undefined) {
            continue;
          }
          const props = propertiesOf(meta);
          const registrationKey = readValue(props, "registrationKey");
          const exportName = readValue(props, "exportName");
          const modulePath = readValue(props, "modulePath");
          if (
            registrationKey === undefined ||
            exportName === undefined ||
            modulePath === undefined
          ) {
            continue;
          }
          const lifetimeText = readValue(props, "lifetime");
          const accessKey = readValue(props, "accessKey");
          if (accessKey !== undefined && explicitAccessKey === undefined) {
            explicitAccessKey = accessKey;
          }
          const dependencyKeysNode = props.get("dependencyKeys");

          contractUnits.push({
            packageName,
            contractName,
            implementationName,
            registrationKey,
            exportName,
            modulePath: `${packageName}/${modulePath}`,
            lifetime:
              lifetimeText !== undefined && isLifetime(lifetimeText)
                ? lifetimeText
                : "singleton",
            isDefault: props.get("default")?.kind === ts.SyntaxKind.TrueKeyword,
            ...(dependencyKeysNode !== undefined
              ? { dependencyKeys: readStringArray(dependencyKeysNode) ?? [] }
              : {}),
          });
        }

        units.push(...contractUnits);

        // The default-slot alias, exactly as `registerContractDefaultAliases` computes it: an
        // explicit `accessKey` when the manifest carries one, otherwise the camel-cased contract
        // name — and only when some implementation is actually marked default.
        const defaultUnit = contractUnits.find((unit) => unit.isDefault);
        if (defaultUnit !== undefined) {
          accessKeys.set(
            explicitAccessKey ??
              contractNameToDefaultRegistrationKey(contractName),
            defaultUnit.registrationKey,
          );
        }
      }
      continue;
    }

    if (IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS.has(topKey)) {
      continue;
    }

    // Everything else at the top level is a group root (the fixed-key rule).
    const groupRoot = unwrapObjectLiteral(topValue);
    const members = groupRoot && propertiesOf(groupRoot).get("members");
    if (members !== undefined) {
      groupMembersByGroupKey.set(topKey, groupMemberKeys(members));
    }
  }

  return {
    units,
    accessKeys,
    groupMembersByGroupKey,
    carriesDependencyKeys: (findDeclaredFeatures(sourceFile) ?? []).includes(
      "dependencyKeys",
    ),
  };
};

export type LoadComposedManifestSupplyOptions = {
  readonly customConditions?: readonly string[];
  /**
   * Swallow per-package resolution/read failures instead of throwing.
   *
   * For inspection, which is a VIEW: a package that cannot be resolved must show up as a thinner
   * report, never as a crashed `ioc inspect`. Generation leaves it off — there, an unreadable
   * composed manifest is a real failure and every other composed loader already treats it as one.
   */
  readonly tolerateUnreadablePackages?: boolean;
};

/**
 * Composed supply for every package in `composedPackageNames`, merged.
 *
 * Later packages do not overwrite earlier ones for group members — composition MERGES group roots
 * across manifests, so members accumulate, which is what `composeManifests` does at runtime.
 */
export const loadComposedManifestSupply = async (
  projectRoot: string,
  composedPackageNames: readonly string[],
  options?: LoadComposedManifestSupplyOptions,
): Promise<ComposedManifestSupply> => {
  const units: ComposedManifestUnit[] = [];
  const accessKeys = new Map<string, string>();
  const groupMembers = new Map<string, string[]>();
  const packagesWithoutDependencyData: string[] = [];

  for (const packageName of composedPackageNames) {
    let parsed: ComposedManifestPackageSupply;
    try {
      const manifestPath = resolvePackageExportPath(
        projectRoot,
        packageName,
        "./iocManifest",
        { customConditions: options?.customConditions },
      );
      parsed = parseComposedManifestSupplySource(
        fs.readFileSync(manifestPath, "utf8"),
        manifestPath,
        packageName,
      );
    } catch (error) {
      if (options?.tolerateUnreadablePackages === true) {
        // Unreadable is not "carries no dependency data" — but from a walk's point of view the
        // consequence is identical, and saying so is strictly better than saying nothing.
        packagesWithoutDependencyData.push(packageName);
        continue;
      }
      throw error;
    }

    units.push(...parsed.units);
    for (const [accessKey, registrationKey] of parsed.accessKeys) {
      if (!accessKeys.has(accessKey)) {
        accessKeys.set(accessKey, registrationKey);
      }
    }
    for (const [groupKey, members] of parsed.groupMembersByGroupKey) {
      const existing = groupMembers.get(groupKey);
      if (existing === undefined) {
        groupMembers.set(groupKey, [...members]);
        continue;
      }
      for (const member of members) {
        if (!existing.includes(member)) {
          existing.push(member);
        }
      }
    }
    if (!parsed.carriesDependencyKeys) {
      packagesWithoutDependencyData.push(packageName);
    }
  }

  return {
    units,
    accessKeys,
    groupMembersByGroupKey: new Map(groupMembers),
    packagesWithoutDependencyData: [...packagesWithoutDependencyData].sort(
      (a, b) => a.localeCompare(b),
    ),
  };
};
