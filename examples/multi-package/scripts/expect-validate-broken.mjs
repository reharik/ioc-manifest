import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.join(scriptsDir, "..");
const repoRoot = path.join(exampleRoot, "..", "..");
const iocCli = path.join(repoRoot, "dist", "cli", "ioc.js");
const appDir = path.join(exampleRoot, "packages", "app");

const result = spawnSync(
  process.execPath,
  [iocCli, "validate", "-c", "./src/ioc.config.validate-broken.ts"],
  {
    cwd: appDir,
    encoding: "utf8",
  },
);

if (result.status === 0) {
  console.error(
    "[example] expected ioc validate to fail for validate-broken config but it passed",
  );
  console.error(result.stdout ?? "");
  process.exit(1);
}

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
if (!/Storge|unknown contract|app-config/i.test(output)) {
  console.error(
    "[example] validate failed but not at expected app-config issue:\n",
    output,
  );
  process.exit(1);
}

console.log(
  "[example] validate-broken reported app-config issue (expected)",
);
