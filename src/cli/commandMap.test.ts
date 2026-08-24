/**
 * The map is a promise about what the tool can do, and this is what keeps it true.
 *
 * Two properties matter and they pull in different directions:
 *
 * 1. **The map is pinned.** A snapshot, in plain mode, byte for byte. Help text is the one output
 *    nobody re-reads after they write it, so a wording drift or a broken column has to fail here or
 *    it ships.
 * 2. **The map is complete.** Pinning a snapshot guards the rows that exist; it says nothing about
 *    a row that should exist and does not. So every verb the *parser* accepts is asserted — by
 *    parsing, not by reading a constant — to have a row in the rendered text. A verb that reaches
 *    a user without a row cannot get past this.
 *
 * The completeness check is given its teeth against a synthetic verb the map does not list, the
 * same way `errorDocs.test.ts` proves its anchor check is not vacuously green.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  formatCommandMap,
  formatVerbHelp,
  flagNamesFor,
  IOC_CLI_STUMBLES,
  IOC_CLI_VERBS,
  IOC_CLI_VERB_NAMES,
  suggestCommand,
  verbsMissingFromMap,
  type IocCliVerbName,
} from "./commandMap.js";
import { parseIocCliArgv } from "./parseIocCli.js";
import { docsUrlForCode } from "../diagnostics/errorDocs.js";

const PLAIN = { color: false } as const;

const THE_MAP = `ioc — convention-based DI for TypeScript: discovery, generation, verification

  generate                    scan, verify, and write the manifest + registry types (the main verb)
  validate                    run the same checks against committed artifacts, without regenerating
  inspect                     what registered under which keys, and why
  inspect --discovery         what was found, what was skipped and why, group membership
  inspect --contract <name>   the same, narrowed to one name — the drill-down for a collapsed report
  explain <key>               one unit: lifetime + provenance, deps, dependents, which scopes reach it
  explain <key> --discovery   the same, re-read from source, so scope-root subtree reach is included

  ioc <command> --help        that command's flags, in detail
  --json                      (inspect, explain, validate) the same report, machine-readable
  IOC_DEBUG=1                 env var: per-phase timings, and stack traces alongside messages

  docs: https://reharik.github.io/ioc-manifest/reference/cli#the-command-map`;

/** `ioc <verb>` with nothing else — the cheapest probe of "does the parser know this word". */
const parserAcceptsVerb = (word: string): boolean => {
  try {
    // `explain` needs its positional, so give every probe one; a verb that ignores it is unharmed.
    return parseIocCliArgv(["node", "ioc", word, "x"]).kind === word;
  } catch {
    return false;
  }
};

describe("the command map", () => {
  describe("When rendered in plain mode", () => {
    it("should be exactly the map that ships", () => {
      assert.equal(formatCommandMap(PLAIN), THE_MAP);
    });

    it("should give the composite spellings rows of their own", () => {
      // The whole point of the map. `discovery` is not a verb, and the row is what teaches that.
      for (const row of [
        "inspect --discovery",
        "inspect --contract <name>",
        "explain <key> --discovery",
      ]) {
        assert.ok(
          formatCommandMap(PLAIN).includes(`  ${row}   `),
          `the map should carry a row for \`${row}\``,
        );
      }
    });

    it("should align the prose column on the plain spelling", () => {
      const columns = formatCommandMap(PLAIN)
        .split("\n")
        .filter((l) => l.startsWith("  ") && !l.trimStart().startsWith("docs:"))
        .map((l) => l.indexOf(l.trim().split(/ {2,}/)[1]!));
      assert.equal(new Set(columns).size, 1, "one prose column, not several");
    });
  });

  describe("When the parser knows a verb", () => {
    it("should be a verb the map has a row for", () => {
      const accepted = IOC_CLI_VERB_NAMES.filter(parserAcceptsVerb);
      assert.deepEqual(
        [...accepted].sort(),
        [...IOC_CLI_VERB_NAMES].sort(),
        "every name in the verb table must actually parse",
      );
      assert.deepEqual(
        verbsMissingFromMap(accepted, formatCommandMap(PLAIN)),
        [],
        "the parser accepts a verb the map does not list",
      );
    });

    it("should fail when a verb has no row — the check's teeth", () => {
      // Without this, "every verb is listed" passes just as happily when the check is broken as
      // when the map is complete. A verb the map has never heard of must be reported.
      assert.deepEqual(
        verbsMissingFromMap(["doctor"], formatCommandMap(PLAIN)),
        ["doctor"],
      );
      assert.deepEqual(
        verbsMissingFromMap(["explain"], formatCommandMap(PLAIN)),
        [],
        "a verb whose row carries an argument still counts as listed",
      );
    });

    it("should agree with the parser about which flags it takes", () => {
      // The flag lists in the table drive both the `--help` pages and the did-you-mean candidates.
      // Probed behaviourally rather than trusted: a flag the table claims and the parser rejects
      // would put a lie on the help screen.
      for (const verb of IOC_CLI_VERBS) {
        for (const flag of flagNamesFor(verb.name)) {
          if (flag === "--help" || flag === "-h") {
            continue;
          }
          // `explain` needs its positional, and a value-taking flag would otherwise eat it.
          const positional = verb.name === "explain" ? ["someKey"] : [];
          assert.doesNotThrow(
            () =>
              parseIocCliArgv([
                "node",
                "ioc",
                verb.name,
                ...positional,
                flag,
                "x",
              ]),
            `\`ioc ${verb.name} ${flag}\` is in the table but the parser rejects it`,
          );
        }
      }
    });

    it("should not claim a flag the verb does not take", () => {
      const notTaken: [IocCliVerbName, string][] = [
        ["generate", "--json"],
        ["generate", "--verbose"],
        ["generate", "--discovery"],
        ["validate", "--contract"],
        ["validate", "--discovery"],
        ["explain", "--contract"],
        ["explain", "--verbose"],
      ];
      for (const [verb, flag] of notTaken) {
        assert.ok(
          !flagNamesFor(verb).includes(flag),
          `the table lists ${flag} under ${verb}, but the parser rejects it`,
        );
        assert.throws(() =>
          parseIocCliArgv(["node", "ioc", verb, flag, "x"]),
        );
      }
    });
  });

  describe("When a verb is asked for its own help", () => {
    it("should print inspect's row, its composites, its flags and its docs link", () => {
      assert.equal(
        formatVerbHelp("inspect", PLAIN),
        `ioc inspect — what registered under which keys, and why

  inspect --discovery         what was found, what was skipped and why, group membership
  inspect --contract <name>   the same, narrowed to one name — the drill-down for a collapsed report

Flags:
  --discovery              read the source instead of the generated manifest: what was found, what was skipped
  --verbose                show the not-a-candidate rows and every group rejection, both collapsed by default
  --contract <substring>   only rows whose contract name — or, with --discovery, export name — contains it
  --json                   emit the full report as JSON, for CI and tooling
  --config <path>, -c      path to ioc.config.ts
  --project <path>         directory to resolve the config from (default: cwd)
  --help, -h               this page

  docs: https://reharik.github.io/ioc-manifest/reference/cli#ioc-inspect`,
      );
    });

    it("should print a composite-free verb as its row and its flags", () => {
      assert.equal(
        formatVerbHelp("validate", PLAIN),
        `ioc validate — run the same checks against committed artifacts, without regenerating

Flags:
  --json                emit the full report as JSON, for CI and tooling
  --config <path>, -c   path to ioc.config.ts
  --project <path>      directory to resolve the config from (default: cwd)
  --help, -h            this page

  docs: https://reharik.github.io/ioc-manifest/reference/cli#ioc-validate`,
      );
    });

    it("should carry the verb's positional into its header", () => {
      assert.match(formatVerbHelp("explain", PLAIN), /^ioc explain <key> — /);
    });
  });

  describe("When the docs pointer is resolved", () => {
    it("should come from errorDocs and not from a hand-written string", () => {
      // The anchors themselves are validated by `errorDocs.test.ts`, against the markdown the site
      // is built from. What is asserted here is that the help output actually goes through it.
      assert.ok(
        formatCommandMap(PLAIN).endsWith(
          `  docs: ${docsUrlForCode("cli-command-map")!}`,
        ),
      );
      for (const verb of IOC_CLI_VERBS) {
        if (verb.docsCode === undefined) {
          continue;
        }
        assert.ok(
          formatVerbHelp(verb.name, PLAIN).endsWith(
            `  docs: ${docsUrlForCode(verb.docsCode)!}`,
          ),
          `${verb.name}'s help should end on the URL errorDocs resolves for ${verb.docsCode}`,
        );
      }
    });
  });

  describe("When colour is on and when it is off", () => {
    it("should be byte-identical in plain mode whatever the environment", () => {
      // The property the whole ansi module exists for: with colour off every escape is the empty
      // string, so a snapshot asserts the real text and a pipe gets exactly what a test sees.
      for (const text of [
        formatCommandMap(PLAIN),
        ...IOC_CLI_VERB_NAMES.map((v) => formatVerbHelp(v, PLAIN)),
      ]) {
        // eslint-disable-next-line no-control-regex
        assert.doesNotMatch(text, /\x1b\[/, "plain output must carry no escapes");
      }
    });

    it("should tint only the spellings, leaving the prose and the layout alone", () => {
      const colored = formatCommandMap({ color: true });
      assert.match(colored, /\x1b\[36mgenerate\x1b\[0m/);
      assert.match(colored, /\x1b\[36minspect --discovery\x1b\[0m/);
      // Stripping the escapes must give back the plain rendering, character for character —
      // which is only true if the padding was measured on the uncoloured spelling.
      assert.equal(
        // eslint-disable-next-line no-control-regex
        colored.replace(/\x1b\[[0-9]+m/g, ""),
        formatCommandMap(PLAIN),
      );
    });

    it("should respect NO_COLOR through the shared resolver", () => {
      const before = process.env["NO_COLOR"];
      const beforeForce = process.env["FORCE_COLOR"];
      try {
        process.env["FORCE_COLOR"] = "1";
        process.env["NO_COLOR"] = "1";
        // eslint-disable-next-line no-control-regex
        assert.doesNotMatch(formatCommandMap(), /\x1b\[/);
      } finally {
        if (before === undefined) {
          delete process.env["NO_COLOR"];
        } else {
          process.env["NO_COLOR"] = before;
        }
        if (beforeForce === undefined) {
          delete process.env["FORCE_COLOR"];
        } else {
          process.env["FORCE_COLOR"] = beforeForce;
        }
      }
    });
  });

  describe("When the cli reference mirrors the map", () => {
    it("should carry the shipped rows verbatim, not a paraphrase of them", () => {
      // Item three of the map's job: the docs section IS the map, so a reader who follows the
      // pointer finds the same words in the same order rather than a second, drifting account.
      // The one omission is the docs pointer itself — a page linking to its own anchor is noise.
      const page = fs.readFileSync(
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "..",
          "..",
          "docs",
          "reference",
          "cli.md",
        ),
        "utf8",
      );
      const fence = /## The command map\n[\s\S]*?```\n([\s\S]*?)```/.exec(page);
      assert.ok(fence !== null, "docs/reference/cli.md has no command-map fence");

      const shipped = formatCommandMap(PLAIN)
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("docs:"))
        .join("\n")
        .trimEnd();
      assert.equal(fence[1]!.trimEnd(), shipped);
    });

    it("should be the anchor the map points at", () => {
      assert.equal(
        docsUrlForCode("cli-command-map"),
        "https://reharik.github.io/ioc-manifest/reference/cli#the-command-map",
      );
    });
  });

  describe("When the stumble table is read", () => {
    it("should suggest a spelling the map actually lists", () => {
      // A stumble pointing at a spelling nobody can type is worse than no stumble at all.
      const map = formatCommandMap(PLAIN);
      for (const { typed, spelling } of IOC_CLI_STUMBLES) {
        assert.ok(
          map.includes(`  ${spelling}`) ||
            IOC_CLI_VERBS.some((v) => v.spelling === spelling),
          `stumble "${typed}" suggests \`${spelling}\`, which the map does not list`,
        );
      }
    });

    it("should never shadow a real verb", () => {
      for (const { typed } of IOC_CLI_STUMBLES) {
        assert.ok(
          !(IOC_CLI_VERB_NAMES as readonly string[]).includes(typed),
          `"${typed}" is a real verb and cannot also be a stumble`,
        );
      }
    });

    it("should leave a genuinely unmatchable word unsuggested", () => {
      assert.equal(suggestCommand("frobnicate"), undefined);
      assert.equal(suggestCommand("qqqqqqqqqq"), undefined);
      // Too short to be near anything meaningfully — two edits is most of the word.
      assert.equal(suggestCommand("xy"), undefined);
    });
  });
});
