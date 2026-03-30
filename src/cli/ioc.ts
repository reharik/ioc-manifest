#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  resolveIocConfigPath,
  tryLoadIocConfig,
} from "../config/loadIocConfig.js";
import type {
  IocContractManifest,
  IocGeneratedContainerManifest,
} from "../core/manifest.js";
import {
  mergeManifestOptionsWithIocConfig,
  resolveManifestOptions,
} from "../generator/manifestOptions.js";
import {
  buildDiscoveryReport,
  buildInspectionReport,
  formatDiscoveryReport,
  formatInspectionReport,
} from "../inspection/index.js";
import { runDiscoveryAnalysis } from "../inspection/runDiscoveryAnalysis.js";

type ParsedCli = {
  command: "inspect";
  iocConfigPath?: string;
  discovery: boolean;
};

const parseArgs = (argv: string[]): ParsedCli => {
  const args = argv.slice(2);
  if (args.length === 0) {
    throw new Error("Usage: ioc inspect [--discovery] [--config <path>]");
  }
  const command = args[0];
  if (command !== "inspect") {
    throw new Error(`Unknown command ${JSON.stringify(command)}. Use inspect.`);
  }
  let iocConfigPath: string | undefined;
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
    if (a.startsWith("-")) {
      throw new Error(`Unknown flag ${JSON.stringify(a)}`);
    }
  }
  return { command, iocConfigPath, discovery };
};

type GeneratedMainManifestModule = {
  iocManifest: IocGeneratedContainerManifest;
};

type GeneratedSupportManifestModule = {
  iocRegistrationManifest: IocContractManifest;
};

const loadGeneratedManifestModules = async (
  iocConfigPath?: string,
): Promise<{
  main: GeneratedMainManifestModule;
  support: GeneratedSupportManifestModule;
}> => {
  const base = resolveManifestOptions();
  const cfgPath = resolveIocConfigPath(base.paths.projectRoot, iocConfigPath);
  const config = await tryLoadIocConfig(cfgPath);
  const options = config
    ? mergeManifestOptionsWithIocConfig(base, config)
    : base;
  const manifestPath = path.resolve(options.paths.manifestOutPath);
  const supportPath = path.join(
    path.dirname(manifestPath),
    "ioc-manifest.support.ts",
  );
  const [main, support] = await Promise.all([
    import(
      pathToFileURL(manifestPath).href
    ) as Promise<GeneratedMainManifestModule>,
    import(
      pathToFileURL(supportPath).href
    ) as Promise<GeneratedSupportManifestModule>,
  ]);
  return { main, support };
};

const main = async (): Promise<void> => {
  const cli = parseArgs(process.argv);
  const { main: mainMod } = await loadGeneratedManifestModules(
    cli.iocConfigPath,
  );

  if (cli.discovery) {
    const analysis = await runDiscoveryAnalysis({
      iocConfigPath: cli.iocConfigPath,
    });
    const report = buildDiscoveryReport(analysis);
    console.log(formatDiscoveryReport(report));
    return;
  }
  const report = buildInspectionReport(mainMod.iocManifest.contracts);
  console.log(formatInspectionReport(report));
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
