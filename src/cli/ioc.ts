#!/usr/bin/env node
/**
 * @fileoverview `ioc` CLI: generates and inspects Awilix manifests.
 *
 * - `ioc generate` — runs the full generation pipeline (discover, plan, emit).
 * - `ioc inspect` — human-readable contract / implementation summary + manifest validation.
 * - `ioc inspect --discovery` — re-runs source discovery (no manifest read) for drift analysis.
 * - `ioc validate` — app mode only: cross-manifest composition checks without writing files (CI gate).
 *
 * Resolves config like generation (`tryLoadIocConfig`, optional `--config`), walking up from cwd
 * (or `--project`) to find `ioc.config.ts` in a monorepo.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { IOC_CLI_HELP_TEXT, parseIocCliArgv } from "./parseIocCli.js";
import { generateManifest } from "../generator/generateManifest.js";
import {
  resolveIocConfigPath,
  resolveProjectRootFromIocConfigPath,
  tryLoadIocConfig,
} from "../config/loadIocConfig.js";
import {
  IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS,
  type IocGeneratedContainerManifest,
  type IocGroupsManifest,
} from "../core/manifest.js";
import {
  mergeManifestOptionsWithIocConfig,
  resolveManifestOptions,
} from "../generator/manifestOptions.js";
import type { ResolvedScanDir } from "../generator/manifestPaths.js";
import {
  buildDiscoveryReport,
  buildInspectionReport,
  filterDiscoveryReportByContract,
  filterInspectionReportByContract,
  formatDiscoveryReport,
  formatDiscoveryReportJson,
  formatInspectionReport,
  formatInspectionReportJson,
} from "../inspection/index.js";
import {
  resolveDiscoveryManifestContext,
  runDiscoveryAnalysis,
} from "../inspection/runDiscoveryAnalysis.js";
import {
  printValidateResult,
  runValidate,
} from "../validate/runValidate.js";

type GeneratedMainManifestModule = {
  iocManifest: IocGeneratedContainerManifest;
};

/**
 * Group roots live as extra top-level manifest properties alongside the fixed keys, so reading them
 * back is "everything that is not fixed". Shape-checked in `buildGroupReportsFromManifest`.
 */
const extractManifestGroupRoots = (
  manifest: IocGeneratedContainerManifest,
): IocGroupsManifest => {
  const groups: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (!IOC_GENERATED_CONTAINER_MANIFEST_FIXED_KEYS.has(key)) {
      groups[key] = value;
    }
  }
  return groups as IocGroupsManifest;
};

const formatResolvedScanDir = (e: ResolvedScanDir): string => {
  if (e.scope !== undefined) {
    return `${e.absPath} [scope=${e.scope}]`;
  }
  return e.absPath;
};

const logInspectContext = (
  cfgPath: string,
  scanDirs: ResolvedScanDir[],
): void => {
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
  const main = (await import(
    pathToFileURL(manifestPath).href
  )) as GeneratedMainManifestModule;
  return main;
};

const main = async (): Promise<void> => {
  const parsed = parseIocCliArgv(process.argv);
  if (parsed.kind === "help") {
    console.log(IOC_CLI_HELP_TEXT.trimEnd());
    return;
  }

  if (parsed.kind === "generate") {
    const cli = parsed.options;
    await generateManifest({
      iocConfigPath: cli.iocConfigPath,
      paths:
        cli.projectDir !== undefined
          ? { projectRoot: path.resolve(cli.projectDir) }
          : undefined,
    });
    return;
  }

  if (parsed.kind === "validate") {
    /**
     * `validate` is separate from `generate` so dev codegen can tolerate transient sibling drift;
     * validate is the pre-merge / pre-deploy gate that reports every composition issue at once.
     * Run after `ioc generate`. Does not modify any files.
     */
    const cli = parsed.options;
    const searchStart = path.resolve(cli.projectDir ?? process.cwd());
    const cfgPath = resolveIocConfigPath(searchStart, cli.iocConfigPath);
    const config = await tryLoadIocConfig(cfgPath);
    if (config === undefined) {
      throw new Error(
        `No ioc config found at ${cfgPath}. Pass --config or run from a project with ioc.config.ts.`,
      );
    }
    const projectRoot = resolveProjectRootFromIocConfigPath(cfgPath);
    const result = await runValidate({
      projectRoot,
      configPath: cfgPath,
      config,
      json: cli.json,
    });
    const code = printValidateResult(result, cli.json);
    if (code !== 0) {
      process.exitCode = code;
    }
    return;
  }

  const cli = parsed.options;
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
    const full = buildDiscoveryReport(analysis);
    const report =
      cli.contract !== undefined
        ? filterDiscoveryReportByContract(full, cli.contract)
        : full;
    console.log(
      cli.json
        ? formatDiscoveryReportJson(report)
        : formatDiscoveryReport(report, { verbose: cli.verbose }),
    );
    return;
  }

  const mainMod = await loadGeneratedManifestModule(
    cli.iocConfigPath,
    searchStart,
  );

  const full = buildInspectionReport(mainMod.iocManifest.contracts, {
    groups: extractManifestGroupRoots(mainMod.iocManifest),
  });
  const report =
    cli.contract !== undefined
      ? filterInspectionReportByContract(full, cli.contract)
      : full;
  console.log(
    cli.json ? formatInspectionReportJson(report) : formatInspectionReport(report),
  );
};

main().catch((error: unknown) => {
  if (process.env.IOC_DEBUG === "1") {
    console.error(error);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(1);
});
