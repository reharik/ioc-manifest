/**
 * @fileoverview Collects scope-root OPENER KEYS from composed package manifests for app-mode codegen.
 *
 * An opener is an ordinary registration: `composeManifests` claims its key on the merged manifest
 * and registers it on the root container. An app factory may therefore inject a library's opener,
 * and when it does, the app must not also be asked for that key in `IocExternals` — the composing
 * app cannot hand-build a scope opener, and does not have to.
 *
 * Read the same way the contract and group loaders read theirs: a fresh parse of the generated
 * manifest SOURCE, never an import of it. The keys are `scopeRoots[Contract][variant].openerKey`,
 * which is the same string `composeManifests` claims at runtime.
 */
import fs from "node:fs";
import ts from "typescript";
import { resolvePackageExportPath } from "./resolveComposedPackageExport.js";

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

/** Every `openerKey: "…"` assignment under the manifest's `scopeRoots` property. */
const extractOpenerKeysFromManifestSource = (
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

  const collectOpenerKeys = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "openerKey" &&
      ts.isStringLiteral(node.initializer)
    ) {
      keys.push(node.initializer.text);
    }
    ts.forEachChild(node, collectOpenerKeys);
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
              prop.name.text === "scopeRoots"
            ) {
              collectOpenerKeys(prop.initializer);
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

/**
 * Opener keys contributed by every composed package, sorted and de-duplicated.
 *
 * A manifest that carries no `scopeRoots` contributes nothing — the field is optional within
 * schema v3, so a package generated before openers existed reads as an empty set rather than an
 * error.
 */
export const loadComposedManifestOpenerKeys = async (
  projectRoot: string,
  composedPackageNames: readonly string[],
  customConditions?: readonly string[],
): Promise<string[]> => {
  const keys = new Set<string>();

  for (const packageName of composedPackageNames) {
    const manifestPath = resolvePackageExportPath(
      projectRoot,
      packageName,
      "./iocManifest",
      { customConditions },
    );
    const content = fs.readFileSync(manifestPath, "utf8");
    for (const key of extractOpenerKeysFromManifestSource(
      content,
      manifestPath,
    )) {
      keys.add(key);
    }
  }

  return [...keys].sort((a, b) => a.localeCompare(b));
};
