/**
 * @fileoverview Terminal colour, in the shape every well-behaved CLI uses it — and in ONE place.
 *
 * The rules are the standard ones: honour `NO_COLOR`, honour `FORCE_COLOR`, and otherwise colour
 * only a TTY. The property that matters most here is the last one: with colour off every escape is
 * the empty string, so plain output is **byte-stable** and the snapshot tests assert the real text
 * rather than a stripped approximation of it.
 *
 * Deliberately not a dependency. The palette is seven escapes; taking on a package to hold them
 * would put a runtime dependency in a published library for something a consumer's own CLI already
 * solved. The interface is the same one `chalk`/`picocolors` expose, so swapping is a one-file
 * change if that ever stops being true.
 */

export type Ansi = {
  reset: string;
  bold: string;
  dim: string;
  cyan: string;
  green: string;
  red: string;
  yellow: string;
  /** Category tags and other structural labels, so they read apart from message prose. */
  magenta: string;
  /** Docs pointers — a URL that looks like a link. */
  underline: string;
};

const NO_ANSI: Ansi = {
  reset: "",
  bold: "",
  dim: "",
  cyan: "",
  green: "",
  red: "",
  yellow: "",
  magenta: "",
  underline: "",
};

const ANSI: Ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  underline: "\x1b[4m",
};

/**
 * Whether this process should emit colour, by the conventional precedence: `NO_COLOR` wins over
 * `FORCE_COLOR`, and a non-TTY stdout (a pipe, a CI log, a test harness) is plain.
 */
export const shouldColorize = (): boolean => {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") {
    return false;
  }
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") {
    return true;
  }
  return process.stdout.isTTY === true;
};

export const ansi = (enabled: boolean): Ansi => (enabled ? ANSI : NO_ANSI);

/** The palette for an explicit `color` option, falling back to {@link shouldColorize}. */
export const resolveAnsi = (color: boolean | undefined): Ansi =>
  ansi(color !== undefined ? color : shouldColorize());
