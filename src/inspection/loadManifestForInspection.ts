/**
 * @fileoverview Reads the generated manifest for `ioc inspect` by PARSING it, never importing it.
 *
 * `inspect` used to `await import()` the generated `ioc-manifest.ts`. That works only under a
 * TypeScript-capable loader, and the `ioc` CLI is not one: `bin/ioc.cjs` spawns plain `node`, which
 * answers a `.ts` import with `Unknown file extension ".ts"`. The command was therefore dead in any
 * consumer running the CLI the normal way, no matter what the project's own dev tooling could load.
 *
 * Parsing is not a workaround, it is the discipline the rest of this codebase already keeps:
 * composition's loaders and `ioc validate` all read generated manifests as source. This module puts
 * `inspect` on the same footing, through the same parser
 * ({@link parseGeneratedManifestSource}), so what `inspect` believes a manifest says and what
 * composition believes it says cannot diverge.
 *
 * Every field the inspection report renders — contract rows, keys, lifetimes, module paths, group
 * roots, opener rows — is a literal in the manifest and comes back verbatim. The one thing a parse
 * cannot recover is `moduleImports`, whose elements are live module namespace objects; no part of
 * the report has ever named them.
 */
import fs from "node:fs";
import path from "node:path";
import type {
  IocContractManifest,
  IocGroupsManifest,
  IocScopeRootsManifest,
} from "../core/manifest.js";
import {
  resolveIocConfigPath,
  resolveProjectRootFromIocConfigPath,
  tryLoadIocConfig,
} from "../config/loadIocConfig.js";
import {
  mergeManifestOptionsWithIocConfig,
  resolveManifestOptions,
} from "../generator/manifestOptions.js";
import type { ResolvedScanDir } from "../generator/manifestPaths.js";
import { parseGeneratedManifestSource } from "../generator/parseGeneratedManifestSource.js";

/** The manifest as `inspect` needs it: exactly the three sections the report is built from. */
export type InspectionManifestSource = {
  readonly manifestPath: string;
  readonly cfgPath: string;
  readonly scanDirs: readonly ResolvedScanDir[];
  readonly contracts: IocContractManifest;
  /** Top-level group roots, per the fixed-key rule. */
  readonly groups: IocGroupsManifest;
  /** Absent when the manifest declares no scope roots. */
  readonly scopeRoots: IocScopeRootsManifest | undefined;
};

/**
 * Parses the generated manifest named by the resolved config.
 *
 * Two failures, two messages. A manifest that is not there is the ordinary "you have not generated
 * yet" case and says so in the same words `ioc validate` uses. A manifest that is there but does not
 * parse is the interesting one: it means the file on disk is not what generation writes, so the
 * message names the file and points at regeneration — the same remedy the `registry-integrity`
 * check offers for a generated file that has stopped matching its sources.
 */
export const loadManifestForInspection = async (
  iocConfigPath?: string,
  searchStartDir?: string,
): Promise<InspectionManifestSource> => {
  const searchStart = path.resolve(searchStartDir ?? process.cwd());
  const cfgPath = resolveIocConfigPath(searchStart, iocConfigPath);
  const config = await tryLoadIocConfig(cfgPath);
  const projectRoot = config
    ? resolveProjectRootFromIocConfigPath(cfgPath)
    : searchStart;
  const base = resolveManifestOptions({ paths: { projectRoot } });
  const options = config
    ? mergeManifestOptionsWithIocConfig(base, config)
    : base;

  const manifestPath = path.resolve(options.paths.manifestOutPath);

  let content: string;
  try {
    content = fs.readFileSync(manifestPath, "utf8");
  } catch {
    throw new Error(
      `[ioc inspect] Generated manifest not found at ${JSON.stringify(manifestPath)}. ` +
        "Run `ioc generate` in this package before `ioc inspect`.",
    );
  }

  let parsed;
  try {
    parsed = parseGeneratedManifestSource(content, manifestPath);
  } catch (error: unknown) {
    // The parser's own message already names the file, so this one does not restate it.
    const detail = (
      error instanceof Error ? error.message : String(error)
    ).replace(/\.\s*$/u, "");
    throw new Error(
      `[ioc inspect] Could not read the generated manifest — ${detail}. ` +
        "Re-run `ioc generate` for this package: a manifest that does not parse is not the file " +
        "generation writes, so inspecting it would report on something the container will never load.",
    );
  }

  return {
    manifestPath,
    cfgPath,
    scanDirs: options.paths.scanDirs,
    contracts: parsed.contracts,
    groups: parsed.groupRoots,
    scopeRoots: parsed.scopeRoots,
  };
};

/**
 * {@link loadManifestForInspection}, but absence is an answer rather than an error.
 *
 * For callers whose report is only ENRICHED by the manifest — `inspect --discovery`, which reads it
 * for the previous generation's group membership and nothing else. A package that has never
 * generated, or whose manifest no longer parses, must still get its discovery report; it just gets
 * it without the facts only a manifest carries.
 */
export const tryLoadManifestForInspection = async (
  iocConfigPath?: string,
  searchStartDir?: string,
): Promise<InspectionManifestSource | undefined> => {
  try {
    return await loadManifestForInspection(iocConfigPath, searchStartDir);
  } catch {
    return undefined;
  }
};
