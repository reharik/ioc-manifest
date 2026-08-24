import {
  existsSync,
  globSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.join(scriptsDir, "..");
const repoRoot = path.join(exampleRoot, "..", "..");
const iocCli = path.join(repoRoot, "dist", "cli", "ioc.js");

if (!existsSync(iocCli)) {
  console.error(
    "[example] ioc-manifest is not built. From the repo root run: npm run build",
  );
  process.exit(1);
}

/** Packages with `src/ioc.config.ts` (same convention as the main test glob). */
const discoverPackages = (root) => {
  const pattern = path.join(root, "packages", "*", "src", "ioc.config.ts");
  const configs = globSync(pattern);
  return configs
    .map((cfg) => path.basename(path.dirname(path.dirname(cfg))))
    .sort((a, b) => a.localeCompare(b));
};

/**
 * Packages whose generation is EXPECTED to fail, asserted by their own script.
 *
 * `app-externals-broken` composes two libraries and supplies neither of the keys they demand.
 * App-mode generation runs the composition suite, so it refuses to emit — which is the whole point
 * of that package. Regenerating it here would abort this script on a deliberate fixture; see
 * `scripts/expect-gen-broken.mjs`, which runs it and asserts the refusal.
 */
const EXPECT_GENERATION_FAILURE = new Set(["app-externals-broken"]);

const packages = discoverPackages(exampleRoot).filter(
  (name) => !EXPECT_GENERATION_FAILURE.has(name),
);

if (packages.length === 0) {
  console.error(
    "[example] no packages found matching packages/*/src/ioc.config.ts",
  );
  process.exit(1);
}

/**
 * Every example package writes here — asserted below rather than parsed out of each config, so a
 * config that moves its output trips the guard instead of silently generating somewhere unchecked.
 */
const GENERATED_DIRNAME = path.join("src", "generated");

/** Emitted by every mode; app mode adds `ioc-composed.ts`, covered by the survivor check. */
const REQUIRED_OUTPUTS = ["ioc-manifest.ts", "ioc-registry.types.ts"];

const generatedFilesIn = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.startsWith("ioc-") && f.endsWith(".ts"))
        .sort((a, b) => a.localeCompare(b))
    : [];

const fail = (message) => {
  console.error(`[example] ${message}`);
  process.exit(1);
};

/**
 * The guard: generation is proven to have run by clearing its outputs first and requiring them
 * back. This script was a silent no-op for weeks — `execSync(cmd, argsArray, opts)` takes
 * `(command, options)`, so the args and the cwd were both dropped and a bare `node` ran in the repo
 * root, exiting 0 and regenerating nothing. Stale committed baselines then looked current. Checking
 * exit status alone could not catch that, and neither could an existence check on files that were
 * already on disk; only "delete, regenerate, require back" makes the failure mode unreachable.
 */
for (const name of packages) {
  const cwd = path.join(exampleRoot, "packages", name);
  const generatedDir = path.join(cwd, GENERATED_DIRNAME);
  const before = generatedFilesIn(generatedDir);

  console.log(`[example] generating manifest for ${name}...`);

  for (const file of before) {
    rmSync(path.join(generatedDir, file));
  }

  // execFileSync, not execSync: see the note above.
  execFileSync(process.execPath, [iocCli, "generate"], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  const after = generatedFilesIn(generatedDir);

  for (const required of REQUIRED_OUTPUTS) {
    if (!after.includes(required)) {
      fail(
        `${name}: generation did not write ${GENERATED_DIRNAME}/${required}. ` +
          `The generator reported success but produced no output — treat this as a harness failure, not a stale baseline.`,
      );
    }
  }

  const missing = before.filter((f) => !after.includes(f));
  if (missing.length > 0) {
    fail(
      `${name}: generation no longer writes ${missing.join(", ")}, which the previous run produced. ` +
        `If that is intended, delete the stale file(s) and the expectation with them; otherwise generation is incomplete.`,
    );
  }

  for (const file of after) {
    if (statSync(path.join(generatedDir, file)).size === 0) {
      fail(`${name}: generation wrote an empty ${GENERATED_DIRNAME}/${file}.`);
    }
  }

  /**
   * The generation RECORD, beside the generated dir.
   *
   * A successful run writes one now — it used to remove the failure marker instead, which said only
   * "the last run did not fail" and was silent about the case the field kept hitting: a run that
   * succeeded, followed by an edit nobody regenerated for. The fingerprint in this file is what
   * lets `ioc validate` say a package's artifacts may predate its sources.
   *
   * `expect-gen-broken.mjs` pins the failure half of the same file; this is the success half.
   */
  const recordPath = path.join(cwd, "src", ".ioc-generation-state.json");
  if (!existsSync(recordPath)) {
    fail(
      `${name}: generation succeeded but left no .ioc-generation-state.json — nothing downstream can tell whether these artifacts still match their sources.`,
    );
  }

  let record;
  try {
    record = JSON.parse(readFileSync(recordPath, "utf8"));
  } catch (error) {
    fail(`${name}: the generation record is not readable JSON: ${String(error)}`);
  }

  if (record.outcome !== "success") {
    fail(
      `${name}: generation succeeded but the record says ${JSON.stringify(record.outcome)}.`,
    );
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(record.inputsHash ?? "")) {
    fail(
      `${name}: the success record carries no usable inputsHash (${JSON.stringify(record.inputsHash)}) — the freshness check would have nothing to compare against.`,
    );
  }

  // Never in the set a consumer diffs to prove generation is deterministic.
  if (after.some((f) => f.startsWith(".ioc-generation-state"))) {
    fail(`${name}: the generation record landed INSIDE ${GENERATED_DIRNAME}.`);
  }

  console.log(`[example] ${name}: wrote ${after.join(", ")}`);
}
