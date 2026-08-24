/**
 * @fileoverview Minimal argv parsing for the `ioc` CLI.
 *
 * The set of words this accepts as commands is NOT written here — it is derived from the verb table
 * in `commandMap.ts`, which is also what `ioc --help` prints. One table, so a verb the parser
 * accepts is a verb the map describes, structurally rather than by anyone remembering to.
 *
 * Parse failures carry a suggestion where one can be found, and a pointer to the map. Deliberately
 * not a usage line: the old tail restated the whole grammar on every error, which is the register
 * that made the commands hard to remember in the first place.
 */
import {
  isIocCliVerbName,
  isKnownFlagOfVerb,
  suggestCommand,
  suggestFlag,
  type IocCliVerbName,
} from "./commandMap.js";

const isHelpFlag = (s: string): boolean => s === "--help" || s === "-h";

/**
 * The second line of any parse error: where the full answer lives.
 *
 * A verb-scoped pointer when the verb parsed and only its flags did not — `ioc inspect --help` is
 * a shorter walk to "what flags does inspect take" than the whole map is.
 */
const helpPointer = (verb?: string): string =>
  verb === undefined
    ? "\n  Run `ioc --help` for the full command list."
    : `\n  Run \`ioc ${verb} --help\` for this command's flags.`;

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
  | { kind: "help"; verb?: IocCliVerbName }
  | { kind: "generate"; options: IocGenerateCliOptions }
  | { kind: "inspect"; options: IocInspectCliOptions }
  | { kind: "explain"; options: IocExplainCliOptions }
  | { kind: "validate"; options: IocValidateCliOptions };

const cliParseError = (detail: string, verb?: string): Error =>
  new Error(`${detail}${helpPointer(verb)}`);

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

  const maybeVerb = args[0] ?? "";
  if (isIocCliVerbName(maybeVerb) && args.slice(1).some(isHelpFlag)) {
    return { kind: "help", verb: maybeVerb };
  }

  const command = args[0] ?? "";
  if (!isIocCliVerbName(command)) {
    const suggestion = suggestCommand(command);
    throw cliParseError(
      `Unknown command ${JSON.stringify(command)}.${
        suggestion === undefined ? "" : ` Did you mean \`ioc ${suggestion}\`?`
      }`,
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
          command,
        );
      }
      discovery = true;
      continue;
    }
    if (a === "--verbose") {
      if (command !== "inspect") {
        throw cliParseError(
          "--verbose is only valid with the inspect command.",
          command,
        );
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
          command,
        );
      }
      json = true;
      continue;
    }
    if (a === "--contract" && args[i + 1]) {
      if (command !== "inspect") {
        throw cliParseError(
          "--contract is only valid with the inspect command.",
          command,
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
      // A flag this verb DOES know only reaches here by having been written without the value it
      // takes — the value-consuming branches above all require `args[i + 1]`. Saying "unknown" to
      // a correctly-spelled flag sends the reader hunting for a typo that is not there.
      if (isKnownFlagOfVerb(command, a)) {
        throw cliParseError(
          `${a} needs a value, e.g. \`ioc ${command} ${a} <value>\`.`,
          command,
        );
      }
      const suggestion = suggestFlag(command, a);
      throw cliParseError(
        `Unknown flag ${JSON.stringify(a)} for \`ioc ${command}\`.${
          suggestion === undefined ? "" : ` Did you mean \`${suggestion}\`?`
        }`,
        command,
      );
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
        command,
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
