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
import { parseGeneratedManifestSource } from "./parseGeneratedManifestSource.js";
import { resolvePackageExportPath } from "./resolveComposedPackageExport.js";

/**
 * Every `scopeRoots[Contract][variant].openerKey` a generated manifest states.
 *
 * A projection of {@link parseGeneratedManifestSource}, the one parser `ioc inspect` and the
 * composed-supply loader also read through, so an opener field the generator starts emitting cannot
 * reach one reader and miss another.
 */
const extractOpenerKeysFromManifestSource = (
  content: string,
  manifestPath: string,
): string[] =>
  Object.values(
    parseGeneratedManifestSource(content, manifestPath).scopeRoots ?? {},
  ).flatMap((variants) =>
    Object.values(variants).map((variant) => variant.openerKey),
  );

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
