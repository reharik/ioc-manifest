/**
 * The discovery-mode verbs must RUN in an app that configures a composed contract.
 *
 * `packages/app`'s `ioc.config.ts` elects `Storage.s3Storage` as the default — a contract declared
 * by `@example/lib-storage`, not by the app. That is a first-class pattern, and it used to make
 * both `--discovery` verbs unreachable: discovery-mode config validation measured `registrations`
 * against LOCAL contract names only, so the sanctioned config read as a typo and the primary
 * diagnostic view refused to start.
 *
 * Pinned here rather than only in the unit suite because the failure was environmental — a real
 * `node_modules` resolution of a real composed manifest, which a temp fixture proves and a
 * committed workspace proves differently.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.join(scriptsDir, "..");
const repoRoot = path.join(exampleRoot, "..", "..");
const iocCli = path.join(repoRoot, "dist", "cli", "ioc.js");
const appDir = path.join(exampleRoot, "packages", "app");

const fail = (message, output) => {
  console.error(`[example] ${message}`);
  if (output !== undefined) {
    console.error(output);
  }
  process.exit(1);
};

const run = (args) =>
  spawnSync(process.execPath, [iocCli, ...args], {
    cwd: appDir,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });

const cases = [
  {
    label: "inspect --discovery",
    args: ["inspect", "--discovery"],
    // The app's own units; the report is over this package's sources by design.
    expect: /buildConfig → AppConfig/,
  },
  {
    label: "explain storage --discovery",
    args: ["explain", "storage", "--discovery"],
    // The composed election the config makes, rendered — which is the whole point of reaching it.
    expect: /elected: s3Storage/,
  },
];

for (const { label, args, expect } of cases) {
  const result = run(args);
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  if (result.status !== 0) {
    fail(
      `${label} exited ${result.status} in an app whose registrations configure a composed contract`,
      output,
    );
  }
  if (!expect.test(output)) {
    fail(`${label} ran but did not print ${expect}`, output);
  }
}

/** The other half: a name nothing declares is still refused, and says how far it looked. */
const unknown = run([
  "inspect",
  "--discovery",
  "-c",
  "./src/ioc.config.validate-broken.ts",
]);
const unknownOutput = `${unknown.stdout ?? ""}\n${unknown.stderr ?? ""}`;
if (unknown.status === 0) {
  fail(
    "inspect --discovery accepted a registrations key no package declares",
    unknownOutput,
  );
}
if (!/not a contract in this package or any composed manifest/.test(unknownOutput)) {
  fail(
    "inspect --discovery refused an unknown contract without stating how far it looked",
    unknownOutput,
  );
}

console.log(
  "[example] inspect/explain --discovery run against the composed contract universe, and still refuse an unknown name (expected)",
);
