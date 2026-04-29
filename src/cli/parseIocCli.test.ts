import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IOC_CLI_HELP_TEXT,
  parseIocCliArgv,
  type IocInspectCliOptions,
} from "./parseIocCli.js";

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

    it("should return help for inspect with --help", () => {
      const r = parseIocCliArgv([...nodeStub(), "inspect", "--help"]);
      assert.deepEqual(r, { kind: "help" });
    });

    it("should return help for inspect with -h", () => {
      const r = parseIocCliArgv([...nodeStub(), "inspect", "-h"]);
      assert.deepEqual(r, { kind: "help" });
    });

    it("should return help when inspect mixes flags and includes -h", () => {
      const r = parseIocCliArgv([
        ...nodeStub(),
        "inspect",
        "--discovery",
        "-h",
      ]);
      assert.deepEqual(r, { kind: "help" });
    });
  });

  describe("When the argv is valid inspect", () => {
    const minimal: IocInspectCliOptions = { discovery: false };

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
        options: { discovery: true },
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
          discovery: false,
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
          discovery: false,
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
          discovery: false,
          projectDir: "./pkg",
        },
      });
    });
  });

  describe("When argv is invalid", () => {
    it("should reject unknown commands", () => {
      assert.throws(
        () => parseIocCliArgv([...nodeStub(), "frobnicate"]),
        /Supported: inspect|\nUsage:/,
      );
    });

    it("should reject unknown flags after inspect", () => {
      assert.throws(
        () => parseIocCliArgv([...nodeStub(), "inspect", "--nope"]),
        /Unknown flag/,
      );
    });
  });

  describe("IOC_CLI_HELP_TEXT", () => {
    it("should document inspect and discovery", () => {
      assert.ok(IOC_CLI_HELP_TEXT.includes("inspect"));
      assert.ok(IOC_CLI_HELP_TEXT.includes("--discovery"));
    });
  });
});
