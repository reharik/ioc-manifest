import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseIocCliArgv, type IocInspectCliOptions } from "./parseIocCli.js";
import { IOC_CLI_STUMBLES } from "./commandMap.js";

const nodeStub = (): string[] => ["node", "dist/cli/ioc.js"];

describe("parseIocCliArgv", () => {
  describe("When the user asks for help", () => {
    it("should return help for argv with only the script (no cli args)", () => {
      const r = parseIocCliArgv([...nodeStub()]);
      assert.deepEqual(r, { kind: "help" });
    });

    it("should return help for argv with --help as the only cli arg", () => {
      const r = parseIocCliArgv([...nodeStub(), "--help"]);
      assert.deepEqual(r, { kind: "help" });
    });

    it("should return help for argv with -h as the only cli arg", () => {
      const r = parseIocCliArgv([...nodeStub(), "-h"]);
      assert.deepEqual(r, { kind: "help" });
    });

    it("should return help for inspect with --help, naming the verb", () => {
      const r = parseIocCliArgv([...nodeStub(), "inspect", "--help"]);
      assert.deepEqual(r, { kind: "help", verb: "inspect" });
    });

    it("should return help for inspect with -h, naming the verb", () => {
      const r = parseIocCliArgv([...nodeStub(), "inspect", "-h"]);
      assert.deepEqual(r, { kind: "help", verb: "inspect" });
    });

    it("should return help when inspect mixes flags and includes -h", () => {
      const r = parseIocCliArgv([
        ...nodeStub(),
        "inspect",
        "--discovery",
        "-h",
      ]);
      assert.deepEqual(r, { kind: "help", verb: "inspect" });
    });

    it("should name the verb for every verb's own --help", () => {
      for (const verb of ["generate", "inspect", "explain", "validate"]) {
        assert.deepEqual(parseIocCliArgv([...nodeStub(), verb, "--help"]), {
          kind: "help",
          verb,
        });
      }
    });
  });

  describe("When the argv is valid inspect", () => {
    const minimal: IocInspectCliOptions = {
      discovery: false,
      verbose: false,
      json: false,
    };

    it("should parse bare inspect", () => {
      const r = parseIocCliArgv([...nodeStub(), "inspect"]);
      assert.deepEqual(r, {
        kind: "inspect",
        options: minimal,
      });
    });

    it("should parse inspect --discovery", () => {
      const r = parseIocCliArgv([...nodeStub(), "inspect", "--discovery"]);
      assert.deepEqual(r, {
        kind: "inspect",
        options: { ...minimal, discovery: true },
      });
    });

    it("should parse --verbose, --json and --contract", () => {
      const r = parseIocCliArgv([
        ...nodeStub(),
        "inspect",
        "--discovery",
        "--verbose",
        "--json",
        "--contract",
        "Media",
      ]);
      assert.deepEqual(r, {
        kind: "inspect",
        options: {
          discovery: true,
          verbose: true,
          json: true,
          contract: "Media",
        },
      });
    });

    it("should parse --contract on manifest-mode inspect", () => {
      const r = parseIocCliArgv([
        ...nodeStub(),
        "inspect",
        "--contract",
        "storage",
      ]);
      assert.deepEqual(r, {
        kind: "inspect",
        options: { ...minimal, contract: "storage" },
      });
    });

    it("should parse --config short and long paths", () => {
      const long = parseIocCliArgv([
        ...nodeStub(),
        "inspect",
        "--config",
        "/abs/ioc.config.ts",
      ]);
      assert.deepEqual(long, {
        kind: "inspect",
        options: {
          ...minimal,
          iocConfigPath: "/abs/ioc.config.ts",
        },
      });

      const short = parseIocCliArgv([
        ...nodeStub(),
        "inspect",
        "-c",
        "./cfg.ts",
      ]);
      assert.deepEqual(short, {
        kind: "inspect",
        options: {
          ...minimal,
          iocConfigPath: "./cfg.ts",
        },
      });
    });

    it("should parse --project", () => {
      const r = parseIocCliArgv([
        ...nodeStub(),
        "inspect",
        "--project",
        "./pkg",
      ]);
      assert.deepEqual(r, {
        kind: "inspect",
        options: {
          ...minimal,
          projectDir: "./pkg",
        },
      });
    });
  });

  describe("When the argv is valid validate", () => {
    it("should parse bare validate", () => {
      const r = parseIocCliArgv([...nodeStub(), "validate"]);
      assert.deepEqual(r, {
        kind: "validate",
        options: { json: false },
      });
    });

    it("should parse validate --json", () => {
      const r = parseIocCliArgv([...nodeStub(), "validate", "--json"]);
      assert.deepEqual(r, {
        kind: "validate",
        options: { json: true },
      });
    });

    it("should parse validate --project", () => {
      const r = parseIocCliArgv([
        ...nodeStub(),
        "validate",
        "--project",
        "./packages/app",
      ]);
      assert.deepEqual(r, {
        kind: "validate",
        options: { projectDir: "./packages/app", json: false },
      });
    });
  });

  describe("When argv is invalid", () => {
    it("should reject unknown commands", () => {
      assert.throws(
        () => parseIocCliArgv([...nodeStub(), "frobnicate"]),
        /Unknown command "frobnicate"\.\n  Run `ioc --help` for the full command list\./,
      );
    });

    it("should reject unknown flags after inspect", () => {
      assert.throws(
        () => parseIocCliArgv([...nodeStub(), "inspect", "--nope"]),
        /Unknown flag/,
      );
    });

    it("should reject --contract and --verbose outside inspect", () => {
      assert.throws(
        () =>
          parseIocCliArgv([...nodeStub(), "validate", "--contract", "Media"]),
        /--contract is only valid with the inspect command/,
      );
      assert.throws(
        () => parseIocCliArgv([...nodeStub(), "generate", "--verbose"]),
        /--verbose is only valid with the inspect command/,
      );
    });

    it("should reject --json on generate", () => {
      assert.throws(
        () => parseIocCliArgv([...nodeStub(), "generate", "--json"]),
        /--json is only valid with the inspect, explain and validate commands/,
      );
    });
  });

  describe("When an unknown command is close to something real", () => {
    const messageOf = (...args: string[]): string => {
      try {
        parseIocCliArgv([...nodeStub(), ...args]);
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error(`expected \`ioc ${args.join(" ")}\` to be rejected`);
    };

    it("should answer a vocabulary miss from the stumble table", () => {
      assert.equal(
        messageOf("discovery"),
        'Unknown command "discovery". Did you mean `ioc inspect --discovery`?\n' +
          "  Run `ioc --help` for the full command list.",
      );
    });

    it("should answer every stumble the table lists", () => {
      // Driven off the table itself, so adding a stumble is one line there and nothing here — and
      // so a table entry that is never actually reached by the suggester cannot sit there unused.
      for (const { typed, spelling } of IOC_CLI_STUMBLES) {
        assert.ok(
          messageOf(typed).includes(
            `Did you mean \`ioc ${spelling}\`?`,
          ),
          `\`ioc ${typed}\` should suggest \`ioc ${spelling}\`, got: ${messageOf(typed)}`,
        );
      }
    });

    it("should answer a typo by edit distance", () => {
      assert.match(messageOf("vaildate"), /Did you mean `ioc validate`\?/);
      assert.match(messageOf("insepct"), /Did you mean `ioc inspect`\?/);
      assert.match(messageOf("genrate"), /Did you mean `ioc generate`\?/);
      // A near miss on a stumble still lands on the spelling that works, not on the stumble.
      assert.match(
        messageOf("discovry"),
        /Did you mean `ioc inspect --discovery`\?/,
      );
    });

    it("should offer nothing at all for a word close to nothing", () => {
      // The map pointer alone. A suggestion pulled from too far away is worse than no suggestion:
      // it sends a reader to try a command they have no reason to want.
      assert.equal(
        messageOf("frobnicate"),
        'Unknown command "frobnicate".\n' +
          "  Run `ioc --help` for the full command list.",
      );
    });

    it("should answer an unknown flag against the verb it followed", () => {
      assert.equal(
        messageOf("inspect", "--disovery"),
        'Unknown flag "--disovery" for `ioc inspect`. Did you mean `--discovery`?\n' +
          "  Run `ioc inspect --help` for this command's flags.",
      );
      assert.equal(
        messageOf("inspect", "--zzzzzzz"),
        'Unknown flag "--zzzzzzz" for `ioc inspect`.\n' +
          "  Run `ioc inspect --help` for this command's flags.",
      );
    });

    it("should not suggest a flag back to itself when the value is what is missing", () => {
      assert.equal(
        messageOf("inspect", "--contract"),
        "--contract needs a value, e.g. `ioc inspect --contract <value>`.\n" +
          "  Run `ioc inspect --help` for this command's flags.",
      );
    });
  });
});

describe("parseIocCliArgv explain", () => {
  const argv = (...args: string[]): string[] => ["node", "ioc", ...args];

  describe("When a key is given", () => {
    it("should parse the positional key and the mode flags", () => {
      const parsed = parseIocCliArgv(argv("explain", "uow", "--discovery", "--json"));

      assert.equal(parsed.kind, "explain");
      assert.deepEqual(parsed.kind === "explain" ? parsed.options : undefined, {
        key: "uow",
        discovery: true,
        json: true,
      });
    });

    it("should default to manifest mode and text output", () => {
      const parsed = parseIocCliArgv(argv("explain", "uow"));

      assert.equal(parsed.kind, "explain");
      assert.equal(parsed.kind === "explain" && parsed.options.discovery, false);
      assert.equal(parsed.kind === "explain" && parsed.options.json, false);
    });
  });

  describe("When no key is given", () => {
    it("should be a usage error rather than an empty report", () => {
      assert.throws(
        () => parseIocCliArgv(argv("explain")),
        /explain needs the cradle key to explain/,
      );
    });
  });

  describe("When --contract is passed to explain", () => {
    it("should be rejected — explain is already narrowed to one key", () => {
      assert.throws(
        () => parseIocCliArgv(argv("explain", "uow", "--contract", "X")),
        /--contract is only valid with the inspect command/,
      );
    });
  });
});
