/**
 * @fileoverview The `ioc` CLI run inside the test process, with its two streams captured.
 *
 * Most of what the CLI tests assert is a property of the REPORT — that a banner's words are right,
 * that it precedes the findings it qualifies, that `--json` carries a field rather than prose. None
 * of that needs a second operating-system process, and paying for one costs ~222ms of `tsx` boot
 * plus a cold re-run of the whole analysis, per assertion. Six of those in a file was most of a
 * two-minute test file.
 *
 * What a captured run still distinguishes is exactly what those assertions are about: `stdout` and
 * `stderr` stay separate, because `console.log` and `console.error` are separate here just as they
 * are through a pipe, and the exit code is returned rather than discarded.
 *
 * What it does NOT prove is the process contract itself — that the exit code reaches a shell, that
 * argv is parsed from a real command line, that nothing but the document lands on a real stdout
 * pipe. Those are properties of a process, and every file using this helper keeps real `spawnSync`
 * cases for them.
 */
import { format } from "node:util";
import { runIocCli } from "../cli/runIocCli.js";

export type IocCliRun = {
  /** What the process would have exited with. */
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

/** Console writes one line per call, so the capture rejoins them the same way. */
const asStream = (lines: readonly string[]): string =>
  lines.length === 0 ? "" : `${lines.join("\n")}\n`;

/**
 * Runs `ioc <args>` in this process and returns what a shell would have seen.
 *
 * `argv` is assembled the way `process.argv` is — executable, script, then the arguments — so the
 * parser under test is reached by the same path a real invocation reaches it by.
 */
export const runIocCliInProcess = async (
  args: readonly string[],
): Promise<IocCliRun> => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const real = {
    log: console.log,
    error: console.error,
    warn: console.warn,
  };
  console.log = (...parts: unknown[]): void => {
    stdout.push(format(...parts));
  };
  // `console.warn` is stderr in Node, and generation uses it for the prettier fallback notice.
  console.error = (...parts: unknown[]): void => {
    stderr.push(format(...parts));
  };
  console.warn = console.error;

  try {
    const code = await runIocCli(["node", "ioc", ...args]);
    return { code, stdout: asStream(stdout), stderr: asStream(stderr) };
  } finally {
    console.log = real.log;
    console.error = real.error;
    console.warn = real.warn;
  }
};
