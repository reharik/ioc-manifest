#!/usr/bin/env node
/**
 * @fileoverview `ioc` CLI: generates and inspects Awilix manifests.
 *
 * - `ioc generate` — runs the full generation pipeline (discover, plan, emit).
 * - `ioc inspect` — human-readable contract / implementation summary + manifest validation. Reads
 *   the generated manifest by PARSING it (see `loadManifestForInspection`), never by importing it:
 *   the CLI runs under plain `node`, which cannot import a `.ts` file at all.
 * - `ioc inspect --discovery` — re-runs source discovery (no manifest read) for drift analysis.
 * - `ioc explain <key>` — one cradle key: what it resolves to, its lifetime and the chain that
 *   decided it, what it depends on, and who depends on it. Same two modes as `inspect`.
 * - `ioc validate` — app mode only: cross-manifest composition checks without writing files (CI gate).
 *
 * Resolves config like generation (`tryLoadIocConfig`, optional `--config`), walking up from cwd
 * (or `--project`) to find `ioc.config.ts` in a monorepo.
 */
import path from "node:path";
import { IOC_CLI_HELP_TEXT, parseIocCliArgv } from "./parseIocCli.js";
import { generateManifest } from "../generator/generateManifest.js";
import {
  resolveIocConfigPath,
  resolveProjectRootFromIocConfigPath,
  tryLoadIocConfig,
} from "../config/loadIocConfig.js";
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
  readPriorGroupMembers,
} from "../inspection/index.js";
import {
  loadManifestForInspection,
  tryLoadManifestForInspection,
} from "../inspection/loadManifestForInspection.js";
import {
  resolveDiscoveryManifestContext,
  runDiscoveryAnalysis,
} from "../inspection/runDiscoveryAnalysis.js";
import {
  explainFromDiscovery,
  explainFromManifest,
} from "../inspection/explain.js";
import {
  formatExplainReport,
  formatExplainReportJson,
} from "../inspection/formatExplain.js";
import {
  printValidateResult,
  runValidate,
} from "../validate/runValidate.js";
import { formatCaughtErrorForTerminal } from "../diagnostics/colorizeDiagnostic.js";
import {
  formatStalenessBanner,
  readGenerationRecord,
  readGenerationState,
  type IocGenerationStateMarker,
} from "../diagnostics/generationState.js";
import { currentInputsHashForConfigPath } from "../diagnostics/currentInputsHash.js";
import {
  formatFreshnessAdvisory,
  formatFreshnessBanner,
  isStale,
  isUnknown,
  judgeFreshness,
} from "../diagnostics/freshness.js";
import { LOCAL_PACKAGE_IDENTIFIER } from "../config/packageIdentifier.js";

const formatResolvedScanDir = (e: ResolvedScanDir): string => {
  if (e.scope !== undefined) {
    return `${e.absPath} [scope=${e.scope}]`;
  }
  return e.absPath;
};

/**
 * Prints the staleness banner ahead of an artifact-derived report, and returns the marker.
 *
 * On stderr, deliberately: the report itself goes to stdout and is routinely piped into a file or
 * another tool. A caveat that vanished into that pipe would be a caveat nobody reads, and one that
 * rode along inside the payload would corrupt it. stderr is where `logInspectContext` already puts
 * the same kind of framing.
 *
 * `--json` gets the marker as data instead, so nothing is printed here.
 */
const bannerIfStale = (
  generatedDir: string,
  json: boolean,
): IocGenerationStateMarker | undefined => {
  const marker = readGenerationState(generatedDir);
  if (marker !== undefined && !json) {
    console.error(formatStalenessBanner(marker));
    console.error("");
  }
  return marker;
};

/**
 * Prints the freshness banner for THIS package ahead of a manifest-derived report.
 *
 * Banner only, and local only. `inspect` and `explain` describe one package's artifacts; there is
 * no composed picture here to attribute a per-finding caveat to, and nothing in their reports is a
 * "finding" in the sense the composition suite means. What a reader needs is the one fact that
 * changes how to read everything below: the manifest being summarised may predate the sources.
 *
 * Manifest mode only. `--discovery` re-reads the source, so its answer is current by construction
 * and a freshness caveat on it would be about a document it is not showing.
 *
 * Nothing is added to `--json`: these documents carry `staleness` because a failed generation is a
 * fact about the artifacts they are reporting. Freshness here is advisory-only by ruling, and the
 * verb that publishes it as data is `ioc validate`.
 */
const bannerIfNotFresh = async (
  generatedDir: string,
  cfgPath: string,
  json: boolean,
): Promise<void> => {
  if (json) {
    return;
  }
  const freshness = judgeFreshness({
    name: LOCAL_PACKAGE_IDENTIFIER,
    sourceId: LOCAL_PACKAGE_IDENTIFIER,
    record: readGenerationRecord(generatedDir),
    currentHash: await currentInputsHashForConfigPath(cfgPath),
  });
  if (isStale(freshness)) {
    console.error(formatFreshnessBanner(freshness));
    console.error("");
  } else if (isUnknown(freshness)) {
    console.error(formatFreshnessAdvisory(freshness));
    console.error("");
  }
};

/** Adds the `staleness` field to a JSON report document, when there is one. Never renames. */
const withStalenessField = (
  json: string,
  marker: IocGenerationStateMarker | undefined,
): string => {
  if (marker === undefined) {
    return json;
  }
  const parsed = JSON.parse(json) as Record<string, unknown>;
  return JSON.stringify({ ...parsed, staleness: marker }, null, 2);
};

const logInspectContext = (
  cfgPath: string,
  scanDirs: readonly ResolvedScanDir[],
): void => {
  console.error(`[ioc inspect] resolved config: ${cfgPath}`);
  console.error(
    `[ioc inspect] resolved discovery scanDirs: ${scanDirs.map(formatResolvedScanDir).join("; ")}`,
  );
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

  if (parsed.kind === "explain") {
    const cli = parsed.options;
    const searchStart = path.resolve(cli.projectDir ?? process.cwd());

    // Two modes, the same two sources `inspect` uses: the manifest on disk, or a fresh scan. The
    // scan is the only one that can say WHY a lifetime is what it is; the report says so itself
    // rather than leaving a reader to wonder why the chain is missing.
    let staleness: IocGenerationStateMarker | undefined;
    let report;
    if (cli.discovery) {
      const analysis = await runDiscoveryAnalysis({
        iocConfigPath: cli.iocConfigPath,
        searchStartDir: searchStart,
      });
      // Discovery mode reads SOURCE, so its own answer is never stale — but a reader who reaches
      // for `--discovery` after a failing generation is reconciling two worlds, and saying that the
      // artifacts beside it are stale is the whole point of the banner.
      staleness = bannerIfStale(analysis.generatedDir, cli.json);
      report = explainFromDiscovery(cli.key, analysis);
    } else {
      const manifest = await loadManifestForInspection(
        cli.iocConfigPath,
        searchStart,
      );
      staleness = bannerIfStale(manifest.generatedDir, cli.json);
      await bannerIfNotFresh(manifest.generatedDir, manifest.cfgPath, cli.json);
      report = explainFromManifest(cli.key, manifest);
    }

    console.log(
      cli.json
        ? withStalenessField(formatExplainReportJson(report), staleness)
        : formatExplainReport(report),
    );
    // An unknown key is a failed question, not a healthy report — CI and shell scripts need to see
    // that in the exit code.
    if (report.resolution.kind === "unknown") {
      process.exitCode = 1;
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
    const staleness = bannerIfStale(
      resolved.options.paths.generatedDir,
      cli.json,
    );

    const analysis = await runDiscoveryAnalysis({
      reuseResolution: resolved,
    });
    // The manifest is read here and nowhere deeper: `runDiscoveryAnalysis` answers "what does the
    // source say", and must keep answering it without a generated file in sight. What the manifest
    // adds is the BEFORE side — which contracts were group members last generation — and a report
    // that cannot find one simply loses that one signal.
    const prior = await tryLoadManifestForInspection(
      cli.iocConfigPath,
      searchStart,
    );
    const full = buildDiscoveryReport({
      ...analysis,
      ...(prior !== undefined
        ? { priorGroupMembers: readPriorGroupMembers(prior.groups) }
        : {}),
    });
    const report =
      cli.contract !== undefined
        ? filterDiscoveryReportByContract(full, cli.contract)
        : full;
    console.log(
      cli.json
        ? withStalenessField(formatDiscoveryReportJson(report), staleness)
        : formatDiscoveryReport(report, { verbose: cli.verbose }),
    );
    return;
  }

  const manifest = await loadManifestForInspection(
    cli.iocConfigPath,
    searchStart,
  );
  logInspectContext(manifest.cfgPath, manifest.scanDirs);
  const staleness = bannerIfStale(manifest.generatedDir, cli.json);
  await bannerIfNotFresh(manifest.generatedDir, manifest.cfgPath, cli.json);

  const full = buildInspectionReport(manifest.contracts, {
    groups: manifest.groups,
    scopeRoots: manifest.scopeRoots,
  });
  const report =
    cli.contract !== undefined
      ? filterInspectionReportByContract(full, cli.contract)
      : full;
  console.log(
    cli.json
      ? withStalenessField(formatInspectionReportJson(report), staleness)
      : formatInspectionReport(report, { verbose: cli.verbose }),
  );
};

/**
 * The one place a thrown diagnostic becomes terminal output.
 *
 * Generation is this tool's primary error surface — the demand model, the group law, scope-root
 * verification and the whole composition suite all reach a developer as a thrown `Error.message` —
 * so this is where those messages get their colour. It is applied HERE and nowhere upstream because
 * `Error.message` itself must stay escape-free: it is serialized, matched and re-wrapped by things
 * that are not terminals (see `diagnostics/colorizeDiagnostic.ts`).
 *
 * `IOC_DEBUG=1` prints the error object whole, stack included, and is left exactly as it was — it
 * exists to show the raw thing, and tinting it would defeat that.
 */
main().catch((error: unknown) => {
  if (process.env.IOC_DEBUG === "1") {
    console.error(error);
  } else {
    console.error(formatCaughtErrorForTerminal(error));
  }
  process.exit(1);
});
