/**
 * @fileoverview The command map: the one place that says what `ioc` can do, in the register a
 * person reaching for the tool actually thinks in.
 *
 * ### Why a map and not a usage line
 *
 * `ioc [--help|-h] | ioc inspect [--discovery] [--verbose] [--contract <substring>] …` is a
 * *grammar*. A grammar answers "is this spelling legal", which is a question you ask after you
 * already know what you want. The question people actually arrive with is "what do you want to
 * do", and a grammar answers it badly: every verb dissolves into the same flag soup, and the
 * spellings that carry the most meaning are the ones the soup buries.
 *
 * The buried ones are composites. `discovery` is not a verb — it is `inspect --discovery` — and a
 * usage line renders that as a bracketed optional beside four other bracketed optionals, which is
 * the same as not rendering it. So here the load-bearing composites get **their own rows**, in the
 * flat list, indistinguishable in weight from the verbs. Being forgettable is what earns a row.
 *
 * ### One table, four consumers
 *
 * {@link IOC_CLI_VERBS} is read by the map, by each verb's `--help` page, by the did-you-mean
 * suggester, and by `parseIocCli`'s notion of which words are commands at all. That last one is
 * deliberate and is the guard the tests lean on: a verb the parser accepts is a verb that came out
 * of this table, so a new verb cannot reach a user without a row describing it.
 *
 * ### Register
 *
 * Descriptions are the plain-language register of the three-register diagnostic work — what
 * happened, in a sentence, without the mechanism. The mechanism is what `--help` on the verb adds,
 * and the rule is what the docs pointer names. The pointer itself comes from `errorDocs`, never
 * from a hand-written string: help text rots exactly the way an error message rots, and it should
 * be caught by the same test.
 */
import { docsUrlForCode } from "../diagnostics/errorDocs.js";
import { resolveAnsi, type Ansi } from "../diagnostics/ansi.js";

export type IocCliVerbName = "generate" | "inspect" | "explain" | "validate";

/** One flag as a verb's `--help` page renders it, and as the parser actually spells it. */
export type IocCliFlag = {
  /** The left column: `--contract <substring>`, `--config <path>, -c`. */
  spelling: string;
  /**
   * Exactly the tokens the parser accepts — no placeholders, no prose. Two consumers: the
   * did-you-mean candidate set, and the test that holds this table to what the parser really does.
   */
  names: readonly string[];
  gloss: string;
};

/** A row of the map: a spelling on the left, one plain-language line on the right. */
export type IocCliRow = {
  spelling: string;
  summary: string;
};

export type IocCliVerb = {
  name: IocCliVerbName;
  /** This verb's own row, as it is invoked — `explain <key>`, not the bare word. */
  spelling: string;
  summary: string;
  /**
   * Composite spellings that get a row of their own. Not every legal combination — the ones a
   * person reaches for by name and then cannot remember how to spell.
   */
  composites: readonly IocCliRow[];
  flags: readonly IocCliFlag[];
  /**
   * The `errorDocs` code resolving this verb's section in the cli reference. Omitted when no
   * section covers the verb: an invented link is worse than no link, the same ruling `errorDocs`
   * makes for a diagnostic no page describes yet.
   */
  docsCode?: string;
};

// ── Flags shared across verbs ───────────────────────────────────────────────────────────────────

const CONFIG_FLAG: IocCliFlag = {
  spelling: "--config <path>, -c",
  names: ["--config", "-c"],
  gloss: "path to ioc.config.ts",
};

const PROJECT_FLAG: IocCliFlag = {
  spelling: "--project <path>",
  names: ["--project"],
  gloss: "directory to resolve the config from (default: cwd)",
};

const HELP_FLAG: IocCliFlag = {
  spelling: "--help, -h",
  names: ["--help", "-h"],
  gloss: "this page",
};

const JSON_FLAG: IocCliFlag = {
  spelling: "--json",
  names: ["--json"],
  gloss: "emit the full report as JSON, for CI and tooling",
};

// ── The verb table ──────────────────────────────────────────────────────────────────────────────

/**
 * Every verb the CLI has, in the order the map prints them: the two that write-or-check first, then
 * the two that answer questions. `parseIocCli` derives its accepted-command set from this array.
 */
export const IOC_CLI_VERBS: readonly IocCliVerb[] = [
  {
    name: "generate",
    spelling: "generate",
    summary:
      "scan, verify, and write the manifest + registry types (the main verb)",
    composites: [],
    flags: [CONFIG_FLAG, PROJECT_FLAG, HELP_FLAG],
    docsCode: "cli-verb-generate",
  },
  {
    name: "validate",
    spelling: "validate",
    summary:
      "run the same checks against committed artifacts, without regenerating",
    composites: [],
    flags: [JSON_FLAG, CONFIG_FLAG, PROJECT_FLAG, HELP_FLAG],
    docsCode: "cli-verb-validate",
  },
  {
    name: "inspect",
    spelling: "inspect",
    summary: "what registered under which keys, and why",
    composites: [
      {
        spelling: "inspect --discovery",
        summary: "what was found, what was skipped and why, group membership",
      },
      {
        spelling: "inspect --contract <name>",
        summary:
          "the same, narrowed to one name — the drill-down for a collapsed report",
      },
    ],
    flags: [
      {
        spelling: "--discovery",
        names: ["--discovery"],
        gloss:
          "read the source instead of the generated manifest: what was found, what was skipped",
      },
      {
        spelling: "--verbose",
        names: ["--verbose"],
        gloss:
          "show the not-a-candidate rows and every group rejection, both collapsed by default",
      },
      {
        spelling: "--contract <substring>",
        names: ["--contract"],
        gloss:
          "only rows whose contract name — or, with --discovery, export name — contains it",
      },
      JSON_FLAG,
      CONFIG_FLAG,
      PROJECT_FLAG,
      HELP_FLAG,
    ],
    docsCode: "cli-verb-inspect",
  },
  {
    name: "explain",
    spelling: "explain <key>",
    summary:
      "one unit: lifetime + provenance, deps, dependents, which scopes reach it",
    composites: [
      {
        spelling: "explain <key> --discovery",
        summary:
          "the same, re-read from source, so scope-root subtree reach is included",
      },
    ],
    flags: [
      {
        spelling: "--discovery",
        names: ["--discovery"],
        gloss:
          "read the source instead of the generated manifest — the mode with subtree reach",
      },
      JSON_FLAG,
      CONFIG_FLAG,
      PROJECT_FLAG,
      HELP_FLAG,
    ],
    docsCode: "cli-verb-explain",
  },
];

/** Every command word the parser accepts, derived — never restated. */
export const IOC_CLI_VERB_NAMES: readonly IocCliVerbName[] = IOC_CLI_VERBS.map(
  (v) => v.name,
);

export const isIocCliVerbName = (s: string): s is IocCliVerbName =>
  (IOC_CLI_VERB_NAMES as readonly string[]).includes(s);

const verbByName = (name: IocCliVerbName): IocCliVerb =>
  IOC_CLI_VERBS.find((v) => v.name === name)!;

// ── The stumble table ───────────────────────────────────────────────────────────────────────────

/**
 * Words people type that this tool does not have, and the spelling they meant.
 *
 * Edit distance handles a *typo* — a hand that knew the word and slipped. It cannot handle a
 * *vocabulary miss*, where the word is confidently typed and simply is not the one this tool uses:
 * `discovery` is nowhere near `inspect` by any string metric, and it is the single most common
 * thing a person reaches for. So the misses are enumerated, beside the verb table they correct,
 * and adding one is a line.
 *
 * `typed` is matched exactly first, and is also thrown into the edit-distance pool — so `discovry`
 * lands on `discovery` and is answered with `inspect --discovery`, not with a shrug.
 */
export type IocCliStumble = {
  /** What was typed. */
  typed: string;
  /** What to suggest, without the leading `ioc `. */
  spelling: string;
};

export const IOC_CLI_STUMBLES: readonly IocCliStumble[] = [
  { typed: "discovery", spelling: "inspect --discovery" },
  { typed: "discover", spelling: "inspect --discovery" },
  { typed: "gen", spelling: "generate" },
  { typed: "build", spelling: "generate" },
  { typed: "check", spelling: "validate" },
  { typed: "verify", spelling: "validate" },
  { typed: "info", spelling: "explain <key>" },
  { typed: "describe", spelling: "explain <key>" },
];

// ── Nearest match ───────────────────────────────────────────────────────────────────────────────

/** Levenshtein distance, two rows. */
const distance = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      row.push(Math.min(row[j - 1]! + 1, prev[j]! + 1, substitution));
    }
    prev = row;
  }
  return prev[b.length]!;
};

/**
 * How wrong a word may be and still be recognised.
 *
 * Two on anything of real length — the usual transposition-plus-slip — and one on a short word,
 * where two edits is most of the word and the "suggestion" would be a guess. Below three
 * characters there is no suggestion at all: `-x` is within one edit of half the short flags in the
 * table, and picking one of them is noise wearing the costume of help.
 */
const tolerance = (typed: string): number =>
  typed.length < 3 ? 0 : typed.length <= 4 ? 1 : 2;

/**
 * The nearest candidate within tolerance; ties break on table order, so output is stable.
 *
 * A distance of zero is not a suggestion. The caller only reaches here for a token the parser
 * already rejected, so an exact hit means the token is *known* and failed for some other reason —
 * suggesting it back would be telling somebody to type what they just typed.
 */
const nearest = (
  typed: string,
  candidates: readonly { typed: string; spelling: string }[],
): string | undefined => {
  const limit = tolerance(typed);
  let best: { spelling: string; d: number } | undefined;
  for (const candidate of candidates) {
    const d = distance(typed.toLowerCase(), candidate.typed.toLowerCase());
    if (d >= 1 && d <= limit && (best === undefined || d < best.d)) {
      best = { spelling: candidate.spelling, d };
    }
  }
  return best?.spelling;
};

/**
 * What the user probably meant by an unknown command, without the leading `ioc `.
 *
 * Exact stumble first: `discovery` is not a near miss for anything, it is a known wrong word with a
 * known right answer, and letting edit distance have a go at it first would only find noise.
 */
export const suggestCommand = (typed: string): string | undefined => {
  const exact = IOC_CLI_STUMBLES.find(
    (s) => s.typed === typed.toLowerCase(),
  );
  if (exact !== undefined) {
    return exact.spelling;
  }
  return nearest(typed, [
    ...IOC_CLI_VERBS.map((v) => ({ typed: v.name, spelling: v.spelling })),
    ...IOC_CLI_STUMBLES,
  ]);
};

/**
 * What the user probably meant by a flag this verb does not know.
 *
 * Only this verb's own flags are candidates. A flag that belongs to a *different* verb already gets
 * a better answer from the parser — one that names the verbs it is valid with — and offering
 * "did you mean `--json`?" on top of it would be answering a question nobody asked.
 */
export const suggestFlag = (
  verb: IocCliVerbName,
  typed: string,
): string | undefined =>
  nearest(
    typed,
    flagNamesFor(verb).map((n) => ({ typed: n, spelling: n })),
  );

/** Every token this verb's parser accepts as a flag. */
export const flagNamesFor = (verb: IocCliVerbName): readonly string[] =>
  verbByName(verb).flags.flatMap((f) => f.names);

/**
 * Whether the verb knows this flag — which, on the path that rejected it, means the flag was
 * spelled right and its value was missing. `ioc inspect --contract` reaching "unknown flag" is the
 * parser telling the truth in the least useful available words; this is what lets the message say
 * the thing that is actually wrong.
 */
export const isKnownFlagOfVerb = (
  verb: IocCliVerbName,
  typed: string,
): boolean => flagNamesFor(verb).includes(typed);

// ── Rendering ───────────────────────────────────────────────────────────────────────────────────

/**
 * The gap between the spelling column and the prose column. Padding is measured on the *plain*
 * spelling and the escapes wrap it, so a coloured map and a piped one align identically.
 */
const GUTTER = 3;

const renderRow = (row: IocCliRow, width: number, c: Ansi): string =>
  `  ${c.cyan}${row.spelling}${c.reset}${" ".repeat(width - row.spelling.length + GUTTER)}${row.summary}`;

const widestOf = (rows: readonly IocCliRow[]): number =>
  rows.reduce((w, r) => Math.max(w, r.spelling.length), 0);

/** The third register, as the docs pointer everywhere else in this tool renders it. */
const docsLine = (code: string | undefined, c: Ansi): string | undefined => {
  const url = code === undefined ? undefined : docsUrlForCode(code);
  return url === undefined
    ? undefined
    : `  ${c.dim}docs: ${c.reset}${c.dim}${c.underline}${url}${c.reset}`;
};

/**
 * Rows that are not verbs but are the next thing a reader needs: where the per-verb detail is, the
 * one cross-cutting flag worth naming on this screen, and the env var for a stack trace.
 *
 * `--json` earns its row and the rest of the flags do not. It is how this tool is consumed by
 * anything that is not a person, and a map that hid it would send every CI author to the docs.
 */
const MAP_FOOTER_ROWS: readonly IocCliRow[] = [
  {
    spelling: "ioc <command> --help",
    summary: "that command's flags, in detail",
  },
  {
    spelling: "--json",
    summary: "(inspect, explain, validate) the same report, machine-readable",
  },
  {
    spelling: "IOC_DEBUG=1",
    summary: "env var: per-phase timings, and stack traces alongside messages",
  },
];

/**
 * The map, for bare `ioc` and for `ioc --help`.
 *
 * `--json` is not applicable to a help screen and is not offered for one; what a pipe does get is
 * plain text, because {@link resolveAnsi} falls through to the TTY check and every escape becomes
 * the empty string.
 */
export const formatCommandMap = (options?: { color?: boolean }): string => {
  const c = resolveAnsi(options?.color);
  const verbRows: IocCliRow[] = IOC_CLI_VERBS.flatMap((v) => [
    { spelling: v.spelling, summary: v.summary },
    ...v.composites,
  ]);
  const width = Math.max(widestOf(verbRows), widestOf(MAP_FOOTER_ROWS));

  return [
    `${c.bold}ioc${c.reset} — convention-based DI for TypeScript: discovery, generation, verification`,
    "",
    ...verbRows.map((r) => renderRow(r, width, c)),
    "",
    ...MAP_FOOTER_ROWS.map((r) => renderRow(r, width, c)),
    "",
    docsLine("cli-command-map", c),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
};

/**
 * One verb's page: its row from the map, its composites, its flags with a line each, its docs link.
 *
 * The map's row is repeated here rather than replaced. Somebody reaching `ioc inspect --help`
 * directly never saw the map, and the row is the sentence that says what the verb is for.
 */
export const formatVerbHelp = (
  name: IocCliVerbName,
  options?: { color?: boolean },
): string => {
  const c = resolveAnsi(options?.color);
  const verb = verbByName(name);

  const lines: (string | undefined)[] = [
    `${c.cyan}ioc ${verb.spelling}${c.reset} — ${verb.summary}`,
  ];

  if (verb.composites.length > 0) {
    const width = widestOf(verb.composites);
    lines.push("", ...verb.composites.map((r) => renderRow(r, width, c)));
  }

  const flagWidth = verb.flags.reduce(
    (w, f) => Math.max(w, f.spelling.length),
    0,
  );
  lines.push(
    "",
    "Flags:",
    ...verb.flags.map(
      (f) =>
        `  ${c.cyan}${f.spelling}${c.reset}${" ".repeat(flagWidth - f.spelling.length + GUTTER)}${f.gloss}`,
    ),
  );

  const docs = docsLine(verb.docsCode, c);
  if (docs !== undefined) {
    lines.push("", docs);
  }

  return lines.filter((line): line is string => line !== undefined).join("\n");
};

/**
 * Every verb name the rendered map actually shows a row for.
 *
 * Extracted so `commandMap.test.ts` can hold the map to the parser mechanically, and so that check
 * can be given its teeth against a synthetic verb the map does not list — the same shape
 * `errorDocs.test.ts` uses to prove its own check is not vacuously green.
 */
export const verbsMissingFromMap = (
  names: readonly string[],
  mapText: string,
): string[] => {
  const rowSpellings = mapText
    .split("\n")
    .filter((line) => line.startsWith("  "))
    .map((line) => line.trim());
  return names.filter(
    (name) =>
      !rowSpellings.some(
        (row) => row === name || row.startsWith(`${name} `),
      ),
  );
};
