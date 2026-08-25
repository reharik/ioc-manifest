#!/usr/bin/env node
/**
 * @fileoverview The `ioc` executable: argv in, exit code out.
 *
 * Everything the CLI actually does is in `runIocCli.ts`. This file is the process boundary and
 * nothing else — it is what `bin/ioc.cjs` spawns, and what the tests that care about the process
 * contract spawn too.
 *
 * `process.exitCode` rather than `process.exit`: the latter would truncate any output still queued
 * on a pipe, which is exactly the situation the `--json` surfaces are used in.
 */
import { runIocCli } from "./runIocCli.js";

process.exitCode = await runIocCli(process.argv);
