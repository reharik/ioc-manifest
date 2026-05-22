/**
 * @fileoverview Loads contract names from composed package manifests for app-mode validation.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export type ComposedManifestContractNames = {
  readonly all: ReadonlySet<string>;
  readonly byPackage: ReadonlyMap<string, ReadonlySet<string>>;
};

type PackageExportsEntry =
  | string
  | {
      readonly import?: string;
      readonly types?: string;
    };

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
    exports?: Record<string, PackageExportsEntry>;
  };
  const manifestExport = pkg.exports?.["./iocManifest"];
  const rel =
    typeof manifestExport === "string"
      ? manifestExport
      : manifestExport?.import ?? manifestExport?.types;
  if (typeof rel !== "string") {
    throw new Error(
      `[ioc-config] ${JSON.stringify(packageName)} must export "./iocManifest" in package.json (see design doc §6.1)`,
    );
  }
  return path.join(pkgDir, rel);
};

const extractContractNamesFromManifestSource = (
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
  const names: string[] = [];

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
              prop.name.text === "contracts" &&
              ts.isObjectLiteralExpression(prop.initializer)
            ) {
              for (const contractProp of prop.initializer.properties) {
                if (
                  ts.isPropertyAssignment(contractProp) &&
                  ts.isIdentifier(contractProp.name)
                ) {
                  names.push(contractProp.name.text);
                }
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return names;
};

const readContractNamesFromManifestFile = (
  manifestPath: string,
): readonly string[] => {
  const content = fs.readFileSync(manifestPath, "utf8");
  const names = extractContractNamesFromManifestSource(content, manifestPath);
  if (names.length === 0) {
    throw new Error(
      `[ioc-config] composed package manifest at ${JSON.stringify(manifestPath)} does not declare iocManifest.contracts`,
    );
  }
  return names;
};

/**
 * Resolves each package's `iocManifest` export path and collects contract names from the generated source.
 */
export const loadComposedManifestContractNames = async (
  projectRoot: string,
  composedPackageNames: readonly string[],
): Promise<ComposedManifestContractNames> => {
  const byPackage = new Map<string, ReadonlySet<string>>();
  const all = new Set<string>();

  for (const packageName of composedPackageNames) {
    const manifestPath = resolveIocManifestPath(projectRoot, packageName);
    const names = readContractNamesFromManifestFile(manifestPath);
    const nameSet = new Set(names);
    byPackage.set(packageName, nameSet);
    for (const name of names) {
      all.add(name);
    }
  }

  return { all, byPackage };
};
