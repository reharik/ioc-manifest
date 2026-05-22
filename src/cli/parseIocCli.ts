/**
 * @fileoverview Minimal argv parsing for the `ioc` CLI (`generate`, `inspect`, `validate`, and `-h/--help`).
 */

/** Printed for `-h`, `--help`, or bare `ioc` — successful exit 0 */
export const IOC_CLI_HELP_TEXT = `ioc — generate and inspect Awilix manifests produced by ioc-manifest

Usage:
  ioc [--help|-h]
  ioc generate [--config <path> | -c <path>] [--project <path>]
  ioc generate [--help|-h]
  ioc inspect [--discovery] [--config <path> | -c <path>] [--project <path>]
  ioc inspect [--help|-h]
  ioc validate [--json] [--config <path> | -c <path>] [--project <path>]
  ioc validate [--help|-h]

Commands:
  ioc generate   Discover factories, build registration plan, and emit ioc-manifest.ts + ioc-registry.types.ts.
  ioc inspect    Load generated ioc-manifest.ts (unless --discovery), print summary.
  ioc validate   App mode only: cross-manifest composition checks (externals, conflicts, groups, defaults). Read-only.

Options:
  --discovery           (inspect only) Re-run discovery and registration planning; do not read manifest.
  --json                (validate only) Emit issues as a JSON array for CI.
  --config PATH   -c    Path to ioc.config.ts
  --project PATH       Directory to resolve config from (default: cwd)

Errors:
  Set IOC_DEBUG=1 for stack traces alongside messages.
`;

const isHelpFlag = (s: string): boolean => s === "--help" || s === "-h";

const conciseUsageTail = (): string =>
  "\nUsage: ioc (--help|-h) | ioc generate [--config <path>|-c <path>] [--project <path>] | ioc inspect [--discovery] [--config <path>|-c <path>] [--project <path>] | ioc validate [--json] [--config <path>|-c <path>] [--project <path>]";

export type IocGenerateCliOptions = {
  iocConfigPath?: string;
  projectDir?: string;
};

export type IocInspectCliOptions = {
  iocConfigPath?: string;
  projectDir?: string;
  discovery: boolean;
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

  const command = args[0];
  if (
    command !== "inspect" &&
    command !== "generate" &&
    command !== "validate"
  ) {
    throw cliParseError(
      `Unknown command ${JSON.stringify(command)}. Supported: generate, inspect, validate.`,
    );
  }

  let iocConfigPath: string | undefined;
  let projectDir: string | undefined;
  let discovery = false;
  let json = false;

  for (let i = 1; i < args.length; i += 1) {
    const a = args[i];
    if (a === undefined) {
      break;
    }
    if (a === "--discovery") {
      if (command !== "inspect") {
        throw cliParseError(
          "--discovery is only valid with the inspect command.",
        );
      }
      discovery = true;
      continue;
    }
    if (a === "--json") {
      if (command !== "validate") {
        throw cliParseError("--json is only valid with the validate command.");
      }
      json = true;
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
      discovery,
    },
  };
};
