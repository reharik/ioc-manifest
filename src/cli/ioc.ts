#!/usr/bin/env node
/**
 * @fileoverview `ioc` CLI: inspects a **generated** manifest on disk (`iocManifest` export).
 *
 * - `ioc inspect` — human-readable contract / implementation summary + manifest validation.
 * - `ioc inspect --discovery` — re-runs source discovery (no manifest read) for drift analysis.
 *
 * Resolves config like generation (`tryLoadIocConfig`, optional `--config`), walking up from cwd
 * (or `--project`) to find `ioc.config.ts` in a monorepo.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  resolveIocConfigPath,
  resolveProjectRootFromIocConfigPath,
  tryLoadIocConfig,
} from "../config/loadIocConfig.js";
import type { IocGeneratedContainerManifest } from "../core/manifest.js";
import {
  mergeManifestOptionsWithIocConfig,
  resolveManifestOptions,
} from "../generator/manifestOptions.js";
import type { ResolvedScanDir } from "../generator/manifestPaths.js";
import {
  buildDiscoveryReport,
  buildInspectionReport,
  formatDiscoveryReport,
  formatInspectionReport,
} from "../inspection/index.js";
import {
  resolveDiscoveryManifestContext,
  runDiscoveryAnalysis,
} from "../inspection/runDiscoveryAnalysis.js";

type ParsedCli = {
  command: "inspect";
  iocConfigPath?: string;
  projectDir?: string;
  discovery: boolean;
};

const parseArgs = (argv: string[]): ParsedCli => {
  const args = argv.slice(2);
  if (args.length === 0) {
    throw new Error(
      "Usage: ioc inspect [--discovery] [--config <path>] [--project <path>]",
    );
  }
  const command = args[0];
  if (command !== "inspect") {
    throw new Error(`Unknown command ${JSON.stringify(command)}. Use inspect.`);
  }
  let iocConfigPath: string | undefined;
  let projectDir: string | undefined;
  let discovery = false;
  for (let i = 1; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--discovery") {
      discovery = true;
      continue;
    }
    if ((a === "--config" || a === "-c") && args[i + 1]) {
      iocConfigPath = args[i + 1];
      i += 1;
      continue;
    }
    if (a === "--project" && args[i + 1]) {
      projectDir = args[i + 1];
      i += 1;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`Unknown flag ${JSON.stringify(a)}`);
    }
  }
  return { command, iocConfigPath, projectDir, discovery };
};

type GeneratedMainManifestModule = {
  iocManifest: IocGeneratedContainerManifest;
};

const formatResolvedScanDir = (e: ResolvedScanDir): string => {
  if (e.importPrefix !== undefined && e.importMode !== undefined) {
    return `${e.absPath} → ${e.importPrefix} (${e.importMode})`;
  }
  return e.absPath;
};

const logInspectContext = (cfgPath: string, scanDirs: ResolvedScanDir[]): void => {
  console.error(`[ioc inspect] resolved config: ${cfgPath}`);
  console.error(
    `[ioc inspect] resolved discovery scanDirs: ${scanDirs.map(formatResolvedScanDir).join("; ")}`,
  );
};

const loadGeneratedManifestModule = async (
  iocConfigPath?: string,
  searchStartDir?: string,
): Promise<GeneratedMainManifestModule> => {
  const searchStart = path.resolve(searchStartDir ?? process.cwd());
  const cfgPath = resolveIocConfigPath(searchStart, iocConfigPath);
  const config = await tryLoadIocConfig(cfgPath);
  const projectRoot = config
    ? resolveProjectRootFromIocConfigPath(cfgPath)
    : searchStart;
  const base = resolveManifestOptions({
    paths: { projectRoot },
  });
  const options = config
    ? mergeManifestOptionsWithIocConfig(base, config)
    : base;
  logInspectContext(cfgPath, options.paths.scanDirs);
  const manifestPath = path.resolve(options.paths.manifestOutPath);
  const main = (await import(pathToFileURL(manifestPath).href)) as
    GeneratedMainManifestModule;
  return main;
};

const main = async (): Promise<void> => {
  const cli = parseArgs(process.argv);
  const searchStart = path.resolve(cli.projectDir ?? process.cwd());

  if (cli.discovery) {
    const resolved = await resolveDiscoveryManifestContext({
      iocConfigPath: cli.iocConfigPath,
      searchStartDir: searchStart,
    });
    logInspectContext(resolved.cfgPath, resolved.options.paths.scanDirs);

    const analysis = await runDiscoveryAnalysis({
      reuseResolution: resolved,
    });
    const report = buildDiscoveryReport(analysis);
    console.log(formatDiscoveryReport(report));
    return;
  }

  const mainMod = await loadGeneratedManifestModule(
    cli.iocConfigPath,
    searchStart,
  );

  const report = buildInspectionReport(mainMod.iocManifest.contracts);
  console.log(formatInspectionReport(report));
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
