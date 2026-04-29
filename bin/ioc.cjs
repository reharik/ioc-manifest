#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const pkgRoot = path.join(__dirname, "..");
const cliJs = path.join(pkgRoot, "dist", "cli", "ioc.js");

const result = spawnSync(
  process.execPath,
  [cliJs, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  throw result.error;
}
process.exit(result.status === null ? 1 : result.status);
