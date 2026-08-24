/**
 * The help surface as a user actually meets it: a real process, a real pipe, a real exit code.
 *
 * `commandMap.test.ts` pins the strings. What it cannot pin is the wiring — that bare `ioc` and
 * `ioc --help` both reach the map, that `ioc inspect --help` reaches inspect's page and not the
 * map, that an unknown verb still exits non-zero after gaining a friendlier message, and that the
 * output arriving through a pipe carries no escapes. Every one of those is a property of the
 * process, so the process is what is run.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const cli = path.join(repoRoot, "src", "cli", "ioc.ts");

type Run = { status: number; stdout: string; stderr: string };

/**
 * Runs the CLI with stdout PIPED — which is the point. A pipe is not a TTY, so `shouldColorize`
 * returns false and the output must come out plain without anyone passing a flag to say so.
 */
const run = (args: readonly string[], env: NodeJS.ProcessEnv = {}): Run => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", cli, ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, ...env },
    },
  );
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[/;

describe("ioc help, end to end", () => {
  describe("When help is asked for", () => {
    it("should print the same map for bare `ioc` and for `ioc --help`", () => {
      const bare = run([]);
      const flag = run(["--help"]);
      const short = run(["-h"]);

      assert.equal(bare.status, 0);
      assert.equal(flag.status, 0);
      assert.equal(short.status, 0);
      assert.equal(bare.stdout, flag.stdout);
      assert.equal(bare.stdout, short.stdout);
      assert.match(bare.stdout, /^ioc — convention-based DI for TypeScript/);
      assert.match(bare.stdout, /^ {2}inspect --discovery {9}what was found/m);
      assert.match(bare.stdout, /docs: https:\/\/reharik\.github\.io/);
    });

    it("should emit no escapes into a pipe", () => {
      // Not because NO_COLOR is set — asserted with it explicitly cleared, so the pipe is doing
      // the work. `npm test` sets NO_COLOR=1, which would make this pass for the wrong reason.
      const piped = run([], { NO_COLOR: "", FORCE_COLOR: "" });
      assert.doesNotMatch(piped.stdout, ANSI);
    });

    it("should still colour when the environment insists", () => {
      const forced = run([], { NO_COLOR: "", FORCE_COLOR: "1" });
      assert.match(forced.stdout, ANSI);
      // …and NO_COLOR wins over FORCE_COLOR, the conventional precedence.
      const suppressed = run([], { NO_COLOR: "1", FORCE_COLOR: "1" });
      assert.doesNotMatch(suppressed.stdout, ANSI);
      assert.equal(
        // eslint-disable-next-line no-control-regex
        forced.stdout.replace(/\x1b\[[0-9]+m/g, ""),
        suppressed.stdout,
      );
    });

    it("should give a verb its own page rather than the map", () => {
      const inspect = run(["inspect", "--help"]);
      assert.equal(inspect.status, 0);
      assert.match(inspect.stdout, /^ioc inspect — what registered under/);
      assert.match(inspect.stdout, /^Flags:$/m);
      assert.match(inspect.stdout, /^ {2}--verbose /m);
      assert.match(inspect.stdout, /reference\/cli#ioc-inspect/);
      assert.doesNotMatch(inspect.stdout, /^ {2}generate /m);

      const generate = run(["generate", "-h"]);
      assert.equal(generate.status, 0);
      assert.match(generate.stdout, /^ioc generate — scan, verify, and write/);
      assert.match(generate.stdout, /^ {2}--config <path>, -c /m);
      // generate takes none of the report flags, and its page must not imply otherwise.
      assert.doesNotMatch(generate.stdout, /--json/);
    });
  });

  describe("When the command is not one this tool has", () => {
    it("should suggest the spelling that works and still exit non-zero", () => {
      const r = run(["discovery"]);
      assert.equal(r.status, 1);
      assert.match(
        r.stderr,
        /Unknown command "discovery"\. Did you mean `ioc inspect --discovery`\?/,
      );
      assert.match(r.stderr, /Run `ioc --help` for the full command list\./);
    });

    it("should fall through to the map pointer alone when nothing is close", () => {
      const r = run(["frobnicate"]);
      assert.equal(r.status, 1);
      assert.doesNotMatch(r.stderr, /Did you mean/);
      assert.match(r.stderr, /Run `ioc --help` for the full command list\./);
    });

    it("should exit non-zero for a typo just the same", () => {
      const r = run(["vaildate"]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /Did you mean `ioc validate`\?/);
    });
  });
});
