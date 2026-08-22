/**
 * The emitted externals assertions, and `ioc validate`, against a REBUILT DEPENDENCY.
 *
 * App-mode `ioc generate` now runs the composition suite, so a fresh generate can no longer produce
 * an app whose own output fails `tsc` on an unsatisfied external — it refuses to emit instead (see
 * `expect-gen-broken.mjs`). What remains, and what this script demonstrates, is the case those two
 * mechanisms exist for: the app's artifacts are COMMITTED and current, and then a library it
 * composes is rebuilt with a new demand.
 *
 * Nothing in the app changes. Two things must catch it without regenerating the app:
 *
 *   1. `tsc` over the app, at the `_IocExpect` assertion in the committed `ioc-composed.ts`.
 *   2. `ioc validate` in the app — the same composition suite generation runs, over committed
 *      artifacts, which is exactly why that verb still exists.
 *
 * The mutation is a single added factory in `lib-services` and is undone in `finally`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.join(scriptsDir, "..");
const repoRoot = path.join(exampleRoot, "..", "..");
const iocCli = path.join(repoRoot, "dist", "cli", "ioc.js");
const appDir = path.join(exampleRoot, "packages", "app");
const libDir = path.join(exampleRoot, "packages", "lib-services");
const appTsconfig = path.join(appDir, "tsconfig.json");

/** The new demand: a key no app in this workspace supplies. */
const NEW_EXTERNAL_KEY = "auditSink";
const probeFactoryPath = path.join(
  libDir,
  "src",
  "factories",
  "buildAuditSinkProbe.ts",
);
const PROBE_FACTORY = `import type { ConfigProbe } from "../types/ConfigProbe.js";

type AuditSinkProbeDeps = {
  /** A demand the composing app does not supply — added by expect-broken-typecheck.mjs. */
  ${NEW_EXTERNAL_KEY}: { write(line: string): void };
};

export const buildAuditSinkProbe = ({
  ${NEW_EXTERNAL_KEY},
}: AuditSinkProbeDeps): ConfigProbe => ({
  label: typeof ${NEW_EXTERNAL_KEY}.write,
});
`;

const fail = (message, output = "") => {
  console.error(`[example] ${message}`);
  if (output.length > 0) {
    console.error(output);
  }
  process.exit(1);
};

const run = (command, args, cwd) =>
  spawnSync(command, args, { cwd, encoding: "utf8" });

const regenerateLibServices = () => {
  const result = run(process.execPath, [iocCli, "generate"], libDir);
  if (result.status !== 0) {
    fail(
      "could not regenerate lib-services",
      `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
};

if (!existsSync(path.join(appDir, "src", "generated", "ioc-composed.ts"))) {
  fail(
    "app has no generated ioc-composed.ts — run `npm run gen` before this script",
  );
}

try {
  // The dependency gains a demand and is rebuilt. The app is not touched.
  writeFileSync(probeFactoryPath, PROBE_FACTORY);
  regenerateLibServices();

  const typecheck = run("npx", ["tsc", "-p", appTsconfig], exampleRoot);
  const typecheckOutput = `${typecheck.stdout ?? ""}\n${typecheck.stderr ?? ""}`;
  if (typecheck.status === 0) {
    fail(
      "expected the app typecheck to fail against the rebuilt lib-services but it passed",
      typecheckOutput,
    );
  }
  if (
    !new RegExp(`${NEW_EXTERNAL_KEY}|does not satisfy|_IocExpect`).test(
      typecheckOutput,
    )
  ) {
    fail(
      "app typecheck failed, but not at the composed externals assertion:",
      typecheckOutput,
    );
  }

  const validate = run(
    process.execPath,
    [iocCli, "validate", "-c", "./src/ioc.config.ts"],
    appDir,
  );
  const validateOutput = `${validate.stdout ?? ""}\n${validate.stderr ?? ""}`;
  if (validate.status === 0) {
    fail(
      "expected ioc validate to fail against the rebuilt lib-services but it passed",
      validateOutput,
    );
  }
  if (!new RegExp(NEW_EXTERNAL_KEY).test(validateOutput)) {
    fail(
      `validate failed, but did not name the unsatisfied key "${NEW_EXTERNAL_KEY}":`,
      validateOutput,
    );
  }

  console.log(
    `[example] rebuilt lib-services demands "${NEW_EXTERNAL_KEY}": app typecheck failed at the composed assertion and ioc validate named the key, both without regenerating the app (expected)`,
  );
} finally {
  rmSync(probeFactoryPath, { force: true });
  regenerateLibServices();
}
