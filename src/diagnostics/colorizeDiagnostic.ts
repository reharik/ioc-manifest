/**
 * @fileoverview Colour for a diagnostic that arrived as an `Error.message`.
 *
 * ### Why the colour is applied HERE and not where the message is built
 *
 * The renderers (`compositionReport`, `formatReports`, `formatExplain`) tint as they compose,
 * because they own their output and hand it straight to a stream. A thrown error cannot work that
 * way: `Error.message` is a string that gets serialized, compared, matched by `assert.match`,
 * embedded in another error's message, and read by tooling that never asked for a terminal. Escape
 * sequences in it corrupt every one of those. So the message stays escape-free all the way out of
 * the generator — and gains colour at the last possible moment, in the CLI's catch, where the only
 * consumer left is a terminal.
 *
 * That boundary matters more than it used to. With the composition suite running inside `ioc
 * generate`, generation is now the PRIMARY error surface of this tool: the demand-model aggregate,
 * the group law, the scope-root verdicts and the whole composition report all reach a developer as
 * a thrown message. Leaving that surface monochrome while `ioc validate` — the same words, a
 * different verb — comes out in full colour is exactly backwards.
 *
 * ### What is tinted
 *
 * Only structure, never prose. Four things a reader scans for:
 *
 * - the bracketed CODE at the head of a line (`[ioc]`, `[grouped-member-demand]`, `[externals]`);
 * - quoted KEYS and names (`"activatePendingUserWriteService"`);
 * - a `file.ts:12` LOCATION;
 * - the `→ docs:` pointer and its URL.
 *
 * One pass over the whole message with a single alternation, so a match cannot land inside another
 * match's replacement — the failure mode a chain of `.replace()` calls has.
 *
 * With colour disabled every escape in {@link Ansi} is the empty string, so the returned string is
 * byte-identical to the input and plain output stays stable.
 */
import { resolveAnsi, type Ansi } from "./ansi.js";

/** The tool's own prefixes — the "this is an ioc failure" tag, tinted as severity. */
const TOOL_PREFIXES: ReadonlySet<string> = new Set(["ioc", "ioc-config"]);

/**
 * One alternation, one pass. Group order is the precedence: the docs pointer is matched before a
 * bare URL could be, and a location before the identifier characters inside it.
 *
 * - 1: `→ docs: <url>`  (arrow + label captured separately from the URL)
 * - 2: a bracketed code at the start of a line, allowing the leading `  - ` of an offender line
 * - 3: `path/file.ts:123`
 * - 4: a double-quoted identifier, key or dotted/scoped name
 */
const STRUCTURE = new RegExp(
  [
    "(→ docs: )(\\S+)",
    "(^[ \\t]*(?:- )?)\\[([A-Za-z][A-Za-z0-9_-]*)\\]",
    "((?:[\\w.@/-]+)\\.[cm]?[jt]sx?:\\d+(?::\\d+)?)",
    '("[A-Za-z_$@][\\w$.@/-]*")',
  ].join("|"),
  "gm",
);

/**
 * Tints the structural landmarks of a diagnostic message.
 *
 * Exported for its own tests; the CLI is the only production caller.
 */
export const colorizeDiagnosticMessage = (
  message: string,
  c: Ansi,
): string =>
  message.replace(
    STRUCTURE,
    (
      match,
      docsArrow: string | undefined,
      docsUrl: string | undefined,
      codeLead: string | undefined,
      code: string | undefined,
      location: string | undefined,
      quoted: string | undefined,
    ) => {
      if (docsArrow !== undefined) {
        return `${c.dim}${docsArrow}${c.reset}${c.dim}${c.underline}${docsUrl}${c.reset}`;
      }
      if (code !== undefined) {
        // The tool prefix is the severity banner; a diagnostic code is a structural label. They
        // read as different things and the palette says so — the same split the composition
        // report's category tag already makes.
        const tint = TOOL_PREFIXES.has(code) ? c.red : c.magenta;
        return `${codeLead ?? ""}${c.bold}${tint}[${code}]${c.reset}`;
      }
      if (location !== undefined) {
        return `${c.cyan}${location}${c.reset}`;
      }
      if (quoted !== undefined) {
        return `${c.cyan}${quoted}${c.reset}`;
      }
      return match;
    },
  );

/**
 * The message of a caught error, ready to print — coloured when this process should colour.
 *
 * Non-`Error` throws are stringified and passed through the same pass: a thrown string carrying a
 * diagnostic is rare but not impossible, and it deserves the same treatment.
 */
export const formatCaughtErrorForTerminal = (
  error: unknown,
  options?: { color?: boolean },
): string => {
  const message = error instanceof Error ? error.message : String(error);
  return colorizeDiagnosticMessage(message, resolveAnsi(options?.color));
};
