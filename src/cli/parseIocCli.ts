/**
 * @fileoverview Minimal argv parsing for the `ioc` CLI (`generate`, `inspect`, `explain`,
 * `validate`, and `-h/--help`).
 */

/** Printed for `-h`, `--help`, or bare `ioc` — successful exit 0 */
export const IOC_CLI_HELP_TEXT = `ioc — generate and inspect Awilix manifests produced by ioc-manifest

Usage:
  ioc [--help|-h]
  ioc generate [--config <path> | -c <path>] [--project <path>]
  ioc generate [--help|-h]
  ioc inspect [--discovery] [--verbose] [--contract <substring>] [--json] [--config <path> | -c <path>] [--project <path>]
  ioc inspect [--help|-h]
  ioc explain <key> [--discovery] [--json] [--config <path> | -c <path>] [--project <path>]
  ioc explain [--help|-h]
  ioc validate [--json] [--config <path> | -c <path>] [--project <path>]
  ioc validate [--help|-h]

Commands:
  ioc generate   Discover factories, build registration plan, and emit ioc-manifest.ts + ioc-registry.types.ts.
  ioc inspect    Load generated ioc-manifest.ts (unless --discovery), print summary.
  ioc explain    Explain ONE cradle key: what it resolves to, its lifetime and where that came from, its dependencies and its dependents. Read-only.
  ioc validate   App mode only: cross-manifest composition checks (externals, conflicts, groups, defaults). Read-only.

Options:
  --discovery           (inspect, explain) Re-run discovery and registration planning; do not read manifest. Required for lifetime provenance and scope-root subtree reach.
  --verbose             (inspect) Also show not-a-candidate rows and every group rejection, both collapsed by default.
  --contract SUBSTRING  (inspect only) Show only rows whose contract name (or, with --discovery, export name) contains SUBSTRING, case-insensitively.
  --json                (inspect, explain, validate) Emit the full report as JSON for CI and tooling.
  --config PATH   -c    Path to ioc.config.ts
  --project PATH       Directory to resolve config from (default: cwd)

Errors:
  Set IOC_DEBUG=1 for stack traces alongside messages.
`;

const isHelpFlag = (s: string): boolean => s === "--help" || s === "-h";

const conciseUsageTail = (): string =>
  "\nUsage: ioc (--help|-h) | ioc generate [--config <path>|-c <path>] [--project <path>] | ioc inspect [--discovery] [--verbose] [--contract <substring>] [--json] [--config <path>|-c <path>] [--project <path>] | ioc explain <key> [--discovery] [--json] [--config <path>|-c <path>] [--project <path>] | ioc validate [--json] [--config <path>|-c <path>] [--project <path>]";

export type IocGenerateCliOptions = {
  iocConfigPath?: string;
  projectDir?: string;
};

export type IocInspectCliOptions = {
  iocConfigPath?: string;
  projectDir?: string;
  discovery: boolean;
  /** Human output only: show not-a-candidate rows. Never affects `--json`, which is always complete. */
  verbose: boolean;
  json: boolean;
  /** Case-insensitive contains-match narrowing the rows shown. */
  contract?: string;
};

export type IocExplainCliOptions = {
  iocConfigPath?: string;
  projectDir?: string;
  /** The cradle key to explain. Required — `explain` with no key is a usage error, not a report. */
  key: string;
  /** Re-run discovery instead of reading the manifest; the only mode with lifetime provenance. */
  discovery: boolean;
  json: boolean;
};

export type IocValidateCliOptions = {
  iocConfigPath?: string;
  projectDir?: string;
  json: boolean;
};

export type ParseIocCliArgvResult =
  | { kind: "help" }
  | { kind: "generate"; options: IocGenerateCliOptions }
  | { kind: "inspect"; options: IocInspectCliOptions }
  | { kind: "explain"; options: IocExplainCliOptions }
  | { kind: "validate"; options: IocValidateCliOptions };

const cliParseError = (detail: string): Error =>
  new Error(`${detail}${conciseUsageTail()}`);

/**
 * Parses `process.argv`-style arrays (starts with executable and script paths).
 */
export const parseIocCliArgv = (
  argv: readonly string[],
): ParseIocCliArgvResult => {
  const args = argv.slice(2);

  if (args.length === 0 || (args.length === 1 && isHelpFlag(args[0] ?? ""))) {
    return { kind: "help" };
  }

  if (args[0] === "inspect" && args.slice(1).some(isHelpFlag)) {
    return { kind: "help" };
  }

  if (args[0] === "generate" && args.slice(1).some(isHelpFlag)) {
    return { kind: "help" };
  }

  if (args[0] === "validate" && args.slice(1).some(isHelpFlag)) {
    return { kind: "help" };
  }

  if (args[0] === "explain" && args.slice(1).some(isHelpFlag)) {
    return { kind: "help" };
  }

  const command = args[0];
  if (
    command !== "inspect" &&
    command !== "generate" &&
    command !== "validate" &&
    command !== "explain"
  ) {
    throw cliParseError(
      `Unknown command ${JSON.stringify(command)}. Supported: generate, inspect, explain, validate.`,
    );
  }

  let iocConfigPath: string | undefined;
  let projectDir: string | undefined;
  let contract: string | undefined;
  let discovery = false;
  let verbose = false;
  let json = false;
  /** `explain`'s positional argument: the first non-flag word after the command. */
  let positional: string | undefined;

  for (let i = 1; i < args.length; i += 1) {
    const a = args[i];
    if (a === undefined) {
      break;
    }
    if (a === "--discovery") {
      if (command !== "inspect" && command !== "explain") {
        throw cliParseError(
          "--discovery is only valid with the inspect and explain commands.",
        );
      }
      discovery = true;
      continue;
    }
    if (a === "--verbose") {
      if (command !== "inspect") {
        throw cliParseError("--verbose is only valid with the inspect command.");
      }
      verbose = true;
      continue;
    }
    if (a === "--json") {
      if (
        command !== "validate" &&
        command !== "inspect" &&
        command !== "explain"
      ) {
        throw cliParseError(
          "--json is only valid with the inspect, explain and validate commands.",
        );
      }
      json = true;
      continue;
    }
    if (a === "--contract" && args[i + 1]) {
      if (command !== "inspect") {
        throw cliParseError(
          "--contract is only valid with the inspect command.",
        );
      }
      contract = args[i + 1];
      i += 1;
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
      throw cliParseError(`Unknown flag ${JSON.stringify(a)}.`);
    }
    if (positional === undefined) {
      positional = a;
    }
  }

  if (command === "generate") {
    return {
      kind: "generate",
      options: {
        ...(iocConfigPath !== undefined ? { iocConfigPath } : {}),
        ...(projectDir !== undefined ? { projectDir } : {}),
      },
    };
  }

  if (command === "explain") {
    if (positional === undefined || positional.length === 0) {
      throw cliParseError(
        "explain needs the cradle key to explain, e.g. `ioc explain uow`.",
      );
    }
    return {
      kind: "explain",
      options: {
        key: positional,
        discovery,
        json,
        ...(iocConfigPath !== undefined ? { iocConfigPath } : {}),
        ...(projectDir !== undefined ? { projectDir } : {}),
      },
    };
  }

  if (command === "validate") {
    return {
      kind: "validate",
      options: {
        json,
        ...(iocConfigPath !== undefined ? { iocConfigPath } : {}),
        ...(projectDir !== undefined ? { projectDir } : {}),
      },
    };
  }

  return {
    kind: "inspect",
    options: {
      ...(iocConfigPath !== undefined ? { iocConfigPath } : {}),
      ...(projectDir !== undefined ? { projectDir } : {}),
      ...(contract !== undefined ? { contract } : {}),
      discovery,
      verbose,
      json,
    },
  };
};
