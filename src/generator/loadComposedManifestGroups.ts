/**
 * @fileoverview Collects group root names from composed package manifests for app-mode validation.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS } from "../core/manifest.js";

const findPackageDirectory = (
  projectRoot: string,
  packageName: string,
): string => {
  const candidates: string[] = [];
  let dir = path.resolve(projectRoot);
  for (let i = 0; i < 8; i++) {
    candidates.push(path.join(dir, "node_modules", packageName));
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  for (const candidate of candidates) {
    const pkgJson = path.join(candidate, "package.json");
    if (fs.existsSync(pkgJson)) {
      return candidate;
    }
  }

  throw new Error(
    `[ioc-config] cannot locate installed package ${JSON.stringify(packageName)} from project root ${JSON.stringify(projectRoot)}`,
  );
};

const resolveIocManifestPath = (
  projectRoot: string,
  packageName: string,
): string => {
  const pkgDir = findPackageDirectory(projectRoot, packageName);
  const pkgJsonPath = path.join(pkgDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
    exports?: Record<string, string | { import?: string; types?: string }>;
  };
  const manifestExport = pkg.exports?.["./iocManifest"];
  const rel =
    typeof manifestExport === "string"
      ? manifestExport
      : manifestExport?.import ?? manifestExport?.types;
  if (typeof rel !== "string") {
    throw new Error(
      `[ioc-config] ${JSON.stringify(packageName)} must export "./iocManifest" in package.json`,
    );
  }
  return path.join(pkgDir, rel);
};

const extractGroupRootKeysFromManifestSource = (
  content: string,
  manifestPath: string,
): string[] => {
  const sourceFile = ts.createSourceFile(
    manifestPath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const keys: string[] = [];

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

  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        const manifestObject =
          decl.initializer !== undefined
            ? unwrapObjectLiteral(decl.initializer)
            : undefined;
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === "iocManifest" &&
          manifestObject !== undefined
        ) {
          for (const prop of manifestObject.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              !IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS.has(prop.name.text)
            ) {
              keys.push(prop.name.text);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return keys;
};

export type ComposedManifestGroupNames = {
  readonly all: ReadonlySet<string>;
};

export const loadComposedManifestGroupNames = async (
  projectRoot: string,
  composedPackageNames: readonly string[],
): Promise<ComposedManifestGroupNames> => {
  const all = new Set<string>();

  for (const packageName of composedPackageNames) {
    const manifestPath = resolveIocManifestPath(projectRoot, packageName);
    const content = fs.readFileSync(manifestPath, "utf8");
    for (const key of extractGroupRootKeysFromManifestSource(
      content,
      manifestPath,
    )) {
      all.add(key);
    }
  }

  return { all };
};

export const collectDeclaredGroupNamesForApp = async (
  projectRoot: string,
  config: {
    groups?: Record<string, unknown>;
    composedManifests?: string[];
    groupBaseTypeAliases?: Record<string, string[]>;
  },
): Promise<ReadonlySet<string>> => {
  const names = new Set<string>(Object.keys(config.groups ?? {}));

  if (config.composedManifests !== undefined && config.composedManifests.length > 0) {
    const composed = await loadComposedManifestGroupNames(
      projectRoot,
      config.composedManifests,
    );
    for (const name of composed.all) {
      names.add(name);
    }
  }

  return names;
};

export const validateGroupBaseTypeAliasKeysAtCodegen = async (
  projectRoot: string,
  config: {
    groups?: Record<string, unknown>;
    composedManifests?: string[];
    groupBaseTypeAliases?: Record<string, string[]>;
  },
  sourceLabel: string,
): Promise<void> => {
  const aliases = config.groupBaseTypeAliases;
  if (aliases === undefined) {
    return;
  }

  const declared = await collectDeclaredGroupNamesForApp(projectRoot, config);

  for (const groupName of Object.keys(aliases)) {
    if (!declared.has(groupName)) {
      throw new Error(
        `[ioc-config] ${sourceLabel} groupBaseTypeAliases.${JSON.stringify(groupName)} does not match any group declared in this app or composed packages`,
      );
    }
  }

  for (const groupName of declared) {
    if (!(groupName in aliases)) {
      continue;
    }
  }
};
