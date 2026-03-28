#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const path = require("node:path");

const pkgRoot = path.join(__dirname, "..");
const cliJs = path.join(pkgRoot, "dist", "cli", "ioc.js");
const requireFromPkg = createRequire(path.join(pkgRoot, "package.json"));
/** Absolute path so `--import` works even when `tsx` is not hoisted to the consumer cwd. */
const tsxLoader = requireFromPkg.resolve("tsx");

const result = spawnSync(
  process.execPath,
  ["--import", tsxLoader, cliJs, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  throw result.error;
}
process.exit(result.status === null ? 1 : result.status);
