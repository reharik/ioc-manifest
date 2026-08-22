/**
 * `packages/app-externals-broken` composes two libraries and supplies neither of the keys they
 * demand. That is a composition error, and app-mode `ioc generate` now runs the composition suite
 * as part of generation — so the honest outcome is that generation REFUSES, names every offender
 * in one report, and writes nothing.
 *
 * This is the demonstration of the rule "everything gen can know, gen enforces". The same package
 * used to generate happily and leave the error to be discovered later — by `ioc validate`, which
 * the primary workflow never runs, or by `tsc` against the emitted assertions.
 */
import { readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.join(scriptsDir, "..");
const repoRoot = path.join(exampleRoot, "..", "..");
const iocCli = path.join(repoRoot, "dist", "cli", "ioc.js");
const pkgDir = path.join(exampleRoot, "packages", "app-externals-broken");
const generatedDir = path.join(pkgDir, "src", "generated");

const fail = (message, output = "") => {
  console.error(`[example] ${message}`);
  if (output.length > 0) {
    console.error(output);
  }
  process.exit(1);
};

const result = spawnSync(process.execPath, [iocCli, "generate"], {
  cwd: pkgDir,
  encoding: "utf8",
});

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

if (result.status === 0) {
  fail(
    "expected ioc generate to fail for app-externals-broken but it succeeded",
    output,
  );
}

if (!/App-mode generation refused/.test(output)) {
  fail(
    "generation failed, but not at the composition suite — check the report:",
    output,
  );
}

for (const key of ["logger", "config"]) {
  if (!new RegExp(`"${key}"`).test(output)) {
    fail(
      `composition report did not name the unsatisfied key "${key}" — a red gen must list every offender in one pass:`,
      output,
    );
  }
}

const written = existsSync(generatedDir)
  ? readdirSync(generatedDir).filter(
      (f) => f.startsWith("ioc-") && f.endsWith(".ts"),
    )
  : [];

if (written.length > 0) {
  fail(
    `generation refused but still wrote ${written.join(", ")} — nothing broken may land on disk`,
  );
}

console.log(
  "[example] app-externals-broken: generation refused with the aggregated composition report, nothing written (expected)",
);
