/**
 * @fileoverview Shared, purely syntactic helpers for deciding whether a module specifier or file
 * path refers to the generated registry-types file (`ioc-registry.types.ts`). Every consumer of
 * these helpers is protecting the same invariant: generation must never type-resolve through its
 * own prior output, so references to the generated file are recognized off the source text alone
 * and must keep working when the generated file does not exist on disk yet (cold start).
 */
import fs from "node:fs";
import path from "node:path";
import { IOC_REGISTRY_TYPES_BASENAME, registryTypesFilePath } from "./manifestPaths.js";

const SCRIPT_EXTENSION_PATTERN = /\.(?:m|c)?[jt]sx?$/;

/** Basename of the generated registry-types file with its extension dropped (`ioc-registry.types`),
 * so a `.js` import specifier and the `.ts` source file compare equal. */
export const REGISTRY_TYPES_BASENAME_STEM = IOC_REGISTRY_TYPES_BASENAME.replace(
  SCRIPT_EXTENSION_PATTERN,
  "",
);

export const moduleSpecifierBasenameStem = (specifier: string): string =>
  path.basename(specifier).replace(SCRIPT_EXTENSION_PATTERN, "");

/**
 * Canonical absolute path for cross-comparison. TypeScript reports absolute realpaths, but
 * `generatedDir` can be project-relative in a composed run, so both sides must be resolved to the
 * same shape. Resolve against cwd (matching how `generatedDir` is used elsewhere —
 * `fs.mkdir(generatedDir)`, `path.relative`), then `realpath` to reconcile monorepo/pnpm symlinks.
 * Falls back to the resolved (non-realpath) path when the target file does not exist yet (the
 * generated file may not be on disk during the first run).
 */
export const canonicalPath = (p: string): string => {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync.native(abs);
  } catch {
    return abs;
  }
};

/**
 * Canonicalizes a script file path with its extension dropped, symlink-resolving the containing
 * directory (which exists even when the file itself does not yet — cold start).
 */
const canonicalStemPath = (absPath: string): string => {
  const stem = path.resolve(absPath).replace(SCRIPT_EXTENSION_PATTERN, "");
  return path.join(canonicalPath(path.dirname(stem)), path.basename(stem));
};

/**
 * True when a module specifier appearing in a scanned source file refers to the generated
 * registry-types file. ENTIRELY SYNTACTIC and cold-start-safe: the specifier's basename stem is
 * compared against the generated basename (the strategy of the 2.3.3 named-alias fix — a bare or
 * path-mapped specifier cannot be module-resolved before the generated file exists), and a
 * relative specifier is additionally resolved against its containing file and compared as an
 * absolute, symlink-resolved path (the strategy of the 2.3.2 self-import fix). Neither side is
 * required to exist on disk.
 */
export const moduleSpecifierTargetsGeneratedRegistry = (
  specifier: string,
  containingFileAbsPath: string,
  generatedDir: string,
): boolean => {
  if (moduleSpecifierBasenameStem(specifier) === REGISTRY_TYPES_BASENAME_STEM) {
    return true;
  }
  if (!specifier.startsWith(".")) {
    return false;
  }
  const resolved = path.resolve(path.dirname(containingFileAbsPath), specifier);
  return (
    canonicalStemPath(resolved) ===
    canonicalStemPath(registryTypesFilePath(generatedDir))
  );
};
