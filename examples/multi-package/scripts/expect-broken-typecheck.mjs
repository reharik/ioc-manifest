import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.join(scriptsDir, "..");
const tsconfig = path.join(
  exampleRoot,
  "packages",
  "app-externals-broken",
  "tsconfig.json",
);

const result = spawnSync(
  "npx",
  ["tsc", "-p", tsconfig],
  {
    cwd: exampleRoot,
    encoding: "utf8",
  },
);

if (result.status === 0) {
  console.error(
    "[example] expected typecheck to fail for app-externals-broken but it passed",
  );
  process.exit(1);
}

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
if (!/LibServicesExternalsAssert|does not satisfy|logger/.test(output)) {
  console.error(
    "[example] typecheck failed but not at the expected externals assertion:\n",
    output,
  );
  process.exit(1);
}

console.log(
  "[example] app-externals-broken failed typecheck at externals assertion (expected)",
);
